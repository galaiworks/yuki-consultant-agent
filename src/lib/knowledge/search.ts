import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { embedTexts, toPgVector } from "@/lib/knowledge/embed";

export type KnowledgeHit = {
  chunk_id: string;
  source_id: string;
  title: string;
  url: string | null;
  kind: "youtube" | "document" | "test_sample";
  is_test: boolean;
  content: string;
  start_sec: number | null;
  score: number;
};

export async function searchKnowledge(
  supabase: SupabaseClient,
  query: string,
  matchCount = 6,
): Promise<KnowledgeHit[]> {
  const vec = (await embedTexts([query], "query"))?.[0];
  const { data, error } = await supabase.rpc("search_knowledge", {
    query_text: query,
    query_embedding: vec ? toPgVector(vec) : null,
    match_count: matchCount,
  });
  if (error) throw new Error(`ナレッジ検索に失敗しました: ${error.message}`);
  return (data ?? []) as KnowledgeHit[];
}

/** 動画なら再生位置付き URL にする(出典をクリックするとその場面から再生) */
export function sourceUrl(hit: Pick<KnowledgeHit, "url" | "kind" | "start_sec" | "source_id">): string {
  if (!hit.url) return `knowledge://${hit.source_id}`;
  if (hit.kind === "youtube" && hit.start_sec != null) {
    const sep = hit.url.includes("?") ? "&" : "?";
    return `${hit.url}${sep}t=${hit.start_sec}s`;
  }
  return hit.url;
}

/**
 * 検索結果を search_result ブロックにする。Claude はこれを引用付きで参照できる。
 * テスト用サンプルはタイトルで YUKI さんの発言ではないと明示する。
 */
export function toSearchResultBlocks(hits: KnowledgeHit[]): Anthropic.Beta.BetaSearchResultBlockParam[] {
  return hits.map((h) => ({
    type: "search_result",
    source: sourceUrl(h),
    title: h.title,
    content: [{ type: "text", text: h.content }],
    citations: { enabled: true },
  }));
}
