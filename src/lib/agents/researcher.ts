import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/config";
import { anthropic, FALLBACK_PARAMS, textOf } from "@/lib/agents/client";
import type { UsageSink } from "@/lib/agents/types";

const SYSTEM = `あなたは米国・日本の市場を調べるリサーチャーです。
- Web 検索で一次情報(政府統計、業界団体、企業の公式発表、大手メディア)を優先して調べます。
- 数字には必ず出典 URL と時点を付けます。見つからない数字は「確認できず」と書き、推測で埋めません。
- 結果は日本語で、1) 要点 3 つ 2) 根拠となる数字と出典 3) まだ分からないこと、の順にまとめます。`;

/** 市場調査エージェント。Web 検索の結果を出典付きで要約して返す */
export async function runResearcher(question: string, usage: UsageSink): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];
  // web_search が長引くと pause_turn で止まるので、数回まで続きを依頼する
  for (let i = 0; i < 4; i++) {
    const res = await anthropic().beta.messages.create({
      model: MODELS.worker,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages,
      ...FALLBACK_PARAMS,
    });
    await usage("researcher", MODELS.worker, res.usage);
    if (res.stop_reason === "refusal") return "この調査は実行できませんでした。";
    if (res.stop_reason !== "pause_turn") return textOf(res.content);
    messages.push({ role: "assistant", content: res.content });
  }
  return "調査が長引いたため途中で止めました。質問を絞って再度お試しください。";
}
