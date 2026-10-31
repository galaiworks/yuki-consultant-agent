import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Anthropic クライアント(API キーはサーバーの環境変数のみ) */
export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * Opus 5.5 / Sonnet 5.5 の安全判定で断られた場合に、サーバー側で
 * 別モデルに自動で引き継ぐ設定。
 */
export const FALLBACK_PARAMS: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

/** 応答本文のテキストだけを連結する */
export function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
