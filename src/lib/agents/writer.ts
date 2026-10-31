import { MODELS } from "@/lib/config";
import { anthropic, FALLBACK_PARAMS, textOf } from "@/lib/agents/client";
import { loadSkill } from "@/lib/skills";
import type { UsageSink } from "@/lib/agents/types";

const KIND_GUIDE: Record<string, string> = {
  diagnosis_report: "経営診断レポート。現状 → 課題(優先順) → 打ち手 → 90 日の進め方 → 確認が必要な点。",
  action_plan: "90 日アクションプラン。週ごとのタスク、担当、完了の基準、つまずいた時の代替案。",
  business_plan: "事業計画書の骨子。市場、顧客、提供価値、収益モデル、数値計画(前提を明記)、リスク。",
  other: "依頼内容に合った構成で。",
};

function system(): string {
  return `あなたは成果物ライターです。相談者に渡す文書を日本語の Markdown で書きます。
- YUKI さんの知見として書くのは、資料に出典があるものだけです。出典は [タイトル](URL) で示します。
- 「【テスト用サンプル】」の資料は YUKI さんの発言ではないので、そう明記します。
- 数字には出典か前提を付けます。法務・税務・投資・ビザは専門家確認を促します。
- 保証表現(必ず・絶対・100%)は使いません。

# 話し方
${loadSkill("yuki-voice")}`;
}

export async function writeDeliverable(input: {
  kind: string;
  brief: string;
  context: string;
  knowledge: string;
  previous?: { content: string; feedback: string };
  usage: UsageSink;
}): Promise<string> {
  const task = input.previous
    ? `前回の原稿を、Guardian の指摘に沿って直してください。指摘されていない良い部分は残します。

# Guardian の指摘
${input.previous.feedback}

# 前回の原稿
${input.previous.content}`
    : `次の成果物を書いてください。\n種類: ${KIND_GUIDE[input.kind] ?? KIND_GUIDE.other}`;

  const stream = anthropic().beta.messages.stream({
    model: MODELS.worker,
    max_tokens: 64000,
    system: [{ type: "text", text: system(), cache_control: { type: "ephemeral", ttl: "1h" } }],
    output_config: { effort: "high" },
    messages: [
      {
        role: "user",
        content: `# 依頼\n${input.brief}\n\n# 相談者\n${input.context}\n\n# 使える資料\n${input.knowledge || "(該当資料なし)"}\n\n# 作業\n${task}`,
      },
    ],
    ...FALLBACK_PARAMS,
  });
  const res = await stream.finalMessage();
  await input.usage("writer", MODELS.worker, res.usage);
  if (res.stop_reason === "refusal") throw new Error("成果物の作成を断られました");
  return textOf(res.content);
}
