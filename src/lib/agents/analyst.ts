import { MODELS } from "@/lib/config";
import { anthropic, FALLBACK_PARAMS, textOf } from "@/lib/agents/client";
import { loadSkill } from "@/lib/skills";
import type { UsageSink } from "@/lib/agents/types";

function system(): string {
  return `あなたは戦略アナリストです。下のフレームワーク集から状況に合う型を 1〜2 個選び、相談者の状況に当てはめて分析します。
- 前提にした数字・仮定は明示します。足りない情報は「確認が必要な点」として列挙します。
- 試算は計算式を示し、桁を確認してから書きます。
- 出力は日本語の Markdown で、1) 使った型と理由 2) 分析 3) 打ち手の候補(優先順) 4) 確認が必要な点。

# フレームワーク集
${loadSkill("yuki-frameworks")}`;
}

/** 戦略分析エージェント */
export async function runAnalyst(situation: string, question: string, usage: UsageSink): Promise<string> {
  const res = await anthropic().beta.messages.create({
    model: MODELS.worker,
    max_tokens: 16000,
    system: [{ type: "text", text: system(), cache_control: { type: "ephemeral", ttl: "1h" } }],
    output_config: { effort: "high" },
    messages: [{ role: "user", content: `# 相談者の状況\n${situation}\n\n# 分析してほしいこと\n${question}` }],
    ...FALLBACK_PARAMS,
  });
  await usage("analyst", MODELS.worker, res.usage);
  if (res.stop_reason === "refusal") return "この分析は実行できませんでした。";
  return textOf(res.content);
}
