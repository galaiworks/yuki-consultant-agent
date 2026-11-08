import type { SupabaseClient } from "@supabase/supabase-js";
import { buildChunkRows, type PersonaLine, type VideoLine } from "@/lib/knowledge/bundle";
import { embedTexts, toPgVector } from "@/lib/knowledge/embed";

/**
 * 取り込みの本体。管理画面(/api/admin/knowledge)とターミナル(scripts/import-bundle.ts)で共用する。
 * service role のクライアントを渡すこと。
 */

/** 素材を利用者から読めなくする SQL が入っているか(社外秘のため、入る前は取り込まない) */
export async function knowledgeTablesReady(admin: SupabaseClient): Promise<boolean> {
  const ready = await admin.from("persona_layers").select("key", { head: true, count: "exact" });
  return !ready.error;
}

export async function importPersona(admin: SupabaseClient, items: PersonaLine[], updatedBy: string | null): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin.from("persona_layers").upsert(
    items.map((p) => ({ key: p.key, body: p.body, version: p.version ?? null, updated_at: now, updated_by: updatedBy })),
  );
  if (error) throw new Error(`判断軸を保存できませんでした: ${error.message}`);
}

export async function clearTestSamples(admin: SupabaseClient): Promise<number> {
  const { error, count } = await admin.from("knowledge_sources").delete({ count: "exact" }).eq("is_test", true);
  if (error) throw new Error(`テスト用サンプルを消せませんでした: ${error.message}`);
  return count ?? 0;
}

/**
 * 動画 1 本を入れる。新しい分を全部入れてから同じ動画の古い分を消すので、
 * 途中で失敗しても元のデータは残る。
 */
export async function importVideo(admin: SupabaseClient, v: VideoLine): Promise<{ chunks: number; embedded: boolean }> {
  const rows = buildChunkRows(v);

  // 先に埋め込みを作る(失敗したら DB は触らない)。VOYAGE_API_KEY が無ければ文字列検索だけで動く
  const vectors: (number[] | null)[] = [];
  for (let i = 0; i < rows.length; i += 64) {
    const batch = await embedTexts(rows.slice(i, i + 64).map((r) => r.content), "document");
    vectors.push(...(batch ?? rows.slice(i, i + 64).map(() => null)));
  }

  const { data: src, error } = await admin
    .from("knowledge_sources")
    .insert({ kind: "youtube", title: v.title, url: v.url, published_at: v.published_at ?? null, is_test: false })
    .select("id")
    .single();
  if (error || !src) throw new Error(`動画を登録できませんでした: ${error?.message}`);

  for (let i = 0; i < rows.length; i += 200) {
    const { error: cErr } = await admin.from("knowledge_chunks").insert(
      rows.slice(i, i + 200).map((r, j) => {
        const vec = vectors[i + j];
        return { source_id: src.id, chunk_index: r.chunk_index, content: r.content, embedding: vec ? toPgVector(vec) : null };
      }),
    );
    if (cErr) {
      // 途中まで入った動画は残さない
      await admin.from("knowledge_sources").delete().eq("id", src.id);
      throw new Error(`本文を登録できませんでした: ${cErr.message}`);
    }
  }

  const del = await admin.from("knowledge_sources").delete().eq("kind", "youtube").eq("url", v.url).neq("id", src.id);
  if (del.error) console.error("old knowledge cleanup failed", del.error.message);
  return { chunks: rows.length, embedded: vectors.some(Boolean) };
}
