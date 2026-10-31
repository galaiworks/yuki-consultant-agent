import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MODELS } from "@/lib/config";
import { anthropic } from "@/lib/agents/client";
import { loadSkill } from "@/lib/skills";
import type { UsageSink } from "@/lib/agents/types";

/** 採点軸と配点(.claude/rules/quality-95.md と一致させる) */
export const AXES = {
  yuki_fidelity: { label: "YUKIらしさ", max: 25 },
  evidence: { label: "根拠と出典", max: 25 },
  actionability: { label: "実行できるか", max: 20 },
  client_fit: { label: "相談者への適合", max: 15 },
  advice_boundary: { label: "助言の線引き", max: 10 },
  overpromise: { label: "過剰約束がないか", max: 5 },
} as const;
export type AxisKey = keyof typeof AXES;

export const THRESHOLD = 95;
export const MAX_RETRIES = 3;

const AxisSchema = z.object({
  score: z.number().describe("この軸の点数。0 以上、配点以下"),
  issues: z.array(z.string()).describe("減点理由。どの段落の何をどう直すか具体的に"),
});

const EvaluationSchema = z.object({
  axes: z.object({
    yuki_fidelity: AxisSchema,
    evidence: AxisSchema,
    actionability: AxisSchema,
    client_fit: AxisSchema,
    advice_boundary: AxisSchema,
    overpromise: AxisSchema,
  }),
  critical_violation: z.boolean().describe("法令違反・なりすまし・個人情報の露出など、即停止すべき問題があるか"),
  critical_reason: z.string().describe("critical_violation が true の理由。なければ空文字"),
});
export type RawEvaluation = z.infer<typeof EvaluationSchema>;

const ReflectionSchema = z.object({
  judgment: z.enum(["approve", "reject", "needs_review"]),
  reason: z.string(),
});
export type Reflection = z.infer<typeof ReflectionSchema>;

export type Evaluation = {
  total: number;
  axes: Record<AxisKey, { score: number; max: number; issues: string[] }>;
  forceReject: boolean;
  criticalReason: string;
};

/** モデルの採点を配点内に収め、合計はコード側で計算する(テスト対象) */
export function normalizeEvaluation(raw: RawEvaluation): Evaluation {
  const axes = {} as Evaluation["axes"];
  let total = 0;
  for (const key of Object.keys(AXES) as AxisKey[]) {
    const max = AXES[key].max;
    const score = Math.max(0, Math.min(max, Math.round(raw.axes[key].score)));
    axes[key] = { score, max, issues: raw.axes[key].issues };
    total += score;
  }
  return { total, axes, forceReject: raw.critical_violation, criticalReason: raw.critical_reason };
}

/** 改善指示。配点の 9 割に届かない軸の指摘だけを渡す */
export function buildFeedback(ev: Evaluation): string {
  const parts: string[] = [];
  for (const key of Object.keys(AXES) as AxisKey[]) {
    const a = ev.axes[key];
    if (a.score < a.max * 0.9 && a.issues.length) {
      parts.push(`## ${AXES[key].label}(${a.score}/${a.max})\n${a.issues.map((i) => `- ${i}`).join("\n")}`);
    }
  }
  return parts.join("\n\n") || "全体をもう一段具体的にしてください。";
}

const RUBRIC = `あなたは Guardian(品質保証)です。成果物を厳しく採点します。「ぱっと見で問題ない」では満点にしません。

採点軸:
- yuki_fidelity (25): 下の話し方ガイドに合っているか。YUKI さん本人の発言でないものを本人の発言として書いていないか
- evidence (25): 主張・数字に出典があるか。出典のない数字は 1 つにつき減点
- actionability (20): 相談者が次に何をするか、期限と担当まで具体的か
- client_fit (15): 相談者の業種・規模・状況に合っているか
- advice_boundary (10): 法務・税務・投資・ビザの判断を断定せず、専門家確認を促しているか
- overpromise (5): 「必ず」「絶対」「100%」など保証表現がないか

減点理由は「第 2 章の『〜』を『〜』に直す」のように、直し方が分かる書き方にします。`;

export async function evaluateDeliverable(
  content: string,
  context: string,
  usage: UsageSink,
): Promise<Evaluation> {
  const res = await anthropic().messages.parse({
    model: MODELS.guardian,
    max_tokens: 16000,
    system: [
      { type: "text", text: `${RUBRIC}\n\n# 話し方ガイド\n${loadSkill("yuki-voice")}`, cache_control: { type: "ephemeral", ttl: "1h" } },
    ],
    output_config: { effort: "high", format: zodOutputFormat(EvaluationSchema) },
    messages: [{ role: "user", content: `# 依頼内容と相談者\n${context}\n\n# 採点する成果物\n${content}` }],
  });
  await usage("guardian", MODELS.guardian, res.usage);
  if (!res.parsed_output) throw new Error("Guardian の採点結果を読み取れませんでした");
  return normalizeEvaluation(res.parsed_output);
}

/** 「これで本当に 95 点ですか?」と自分に問い返す */
export async function selfReflect(content: string, ev: Evaluation, usage: UsageSink): Promise<Reflection> {
  const res = await anthropic().messages.parse({
    model: MODELS.guardian,
    max_tokens: 8000,
    output_config: { effort: "high", format: zodOutputFormat(ReflectionSchema) },
    messages: [
      {
        role: "user",
        content: `あなたは先ほどこの成果物を ${ev.total}/100 点と採点しました。本当に 95 点以上ですか。
細部まで見直してください。一文でも YUKI さんらしくない表現、出典のない数字、保証表現、専門家に確認すべき断定があれば reject。
迷う場合は needs_review。理由を具体的に書いてください。

# 成果物
${content}`,
      },
    ],
  });
  await usage("guardian_reflection", MODELS.guardian, res.usage);
  return res.parsed_output ?? { judgment: "needs_review", reason: "自己反省の結果を読み取れませんでした" };
}

export type NextStep =
  | { action: "approve" }
  | { action: "revise"; feedback: string }
  | { action: "escalate"; reason: "critical_violation" | "max_retries_exceeded" | "ambiguous_judgment" };

/**
 * 95 点ループの判断(テスト対象)。
 * attempt は 0 始まり。attempt が MAX_RETRIES に達したら作り直さずに人へ回す。
 */
export function decideNextStep(ev: Evaluation, attempt: number, reflection?: Reflection): NextStep {
  if (ev.forceReject) return { action: "escalate", reason: "critical_violation" };
  if (ev.total >= THRESHOLD && reflection) {
    if (reflection.judgment === "approve") return { action: "approve" };
    if (reflection.judgment === "needs_review") return { action: "escalate", reason: "ambiguous_judgment" };
  }
  if (attempt >= MAX_RETRIES) return { action: "escalate", reason: "max_retries_exceeded" };
  const feedback =
    ev.total >= THRESHOLD && reflection
      ? `自己反省で不合格: ${reflection.reason}\n\n${buildFeedback(ev)}`
      : buildFeedback(ev);
  return { action: "revise", feedback };
}
