import type { SupabaseClient } from "@supabase/supabase-js";

/** USD / 100 万トークン。料金改定時はここだけ直す */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
/** Web 検索 1 回あたり(USD) */
const WEB_SEARCH_USD = 0.01;

export type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

export type UsageRecord = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  web_search_requests: number;
  cost_usd: number;
};

/** API レスポンスの usage から費用を計算する(テスト対象) */
export function computeUsage(model: string, u: UsageLike): UsageRecord {
  const p = PRICES[model];
  if (!p) throw new Error(`料金表にないモデルです: ${model}`);
  const rec = {
    model,
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    web_search_requests: u.server_tool_use?.web_search_requests ?? 0,
  };
  const cost =
    (rec.input_tokens * p.input +
      rec.output_tokens * p.output +
      rec.cache_read_input_tokens * p.cacheRead +
      rec.cache_creation_input_tokens * p.cacheWrite) /
      1_000_000 +
    rec.web_search_requests * WEB_SEARCH_USD;
  return { ...rec, cost_usd: Math.round(cost * 1_000_000) / 1_000_000 };
}

export type UsageContext = {
  userId: string;
  conversationId?: string | null;
  deliverableId?: string | null;
};

/** 1 回の API 呼び出しの利用料を記録する(service role で書く) */
export async function recordUsage(
  admin: SupabaseClient,
  ctx: UsageContext,
  agent: string,
  model: string,
  usage: UsageLike,
): Promise<void> {
  const rec = computeUsage(model, usage);
  const { error } = await admin.from("usage_logs").insert({
    user_id: ctx.userId,
    conversation_id: ctx.conversationId ?? null,
    deliverable_id: ctx.deliverableId ?? null,
    agent,
    ...rec,
  });
  // 記録失敗で相談そのものは止めないが、必ずログに残す
  if (error) console.error("usage_logs への記録に失敗", error.message);
}
