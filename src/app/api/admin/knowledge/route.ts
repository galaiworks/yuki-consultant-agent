import { z } from "zod";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildChunkRows, PersonaLineSchema, VideoLineSchema } from "@/lib/knowledge/bundle";
import { embedTexts, toPgVector } from "@/lib/knowledge/embed";
import { clearPersonaCache } from "@/lib/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("persona"), items: z.array(PersonaLineSchema).min(1).max(7) }),
  z.object({ action: z.literal("video"), item: VideoLineSchema }),
  z.object({ action: z.literal("clear_test") }),
]);

/**
 * 管理画面からの取り込み。ブラウザがファイルを読み、1 本ずつ送ってくる。
 * 同じ動画をもう一度送ると、前の分を消して入れ直す(何度やり直しても重複しない)。
 */
export async function POST(req: Request) {
  const { user, isAdmin } = await currentUserIsAdmin();
  if (!user || !isAdmin) return Response.json({ error: "管理者だけが使えます" }, { status: 403 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "送られたデータの形式が違います" }, { status: 400 });
  const body = parsed.data;
  const admin = createSupabaseAdminClient();

  // 素材をクライアントから読めなくするマイグレーションが入るまでは取り込まない(社外秘のため)
  const ready = await admin.from("persona_layers").select("key", { head: true, count: "exact" });
  if (ready.error) {
    return Response.json(
      { error: "先に Supabase で 20261104000200_private_knowledge_and_persona.sql を実行してください" },
      { status: 409 },
    );
  }

  if (body.action === "persona") {
    const now = new Date().toISOString();
    const { error } = await admin.from("persona_layers").upsert(
      body.items.map((p) => ({ key: p.key, body: p.body, version: p.version ?? null, updated_at: now, updated_by: user.id })),
    );
    if (error) return Response.json({ error: `判断軸を保存できませんでした: ${error.message}` }, { status: 500 });
    clearPersonaCache();
    return Response.json({ ok: true, saved: body.items.map((p) => p.key) });
  }

  if (body.action === "clear_test") {
    const { error, count } = await admin.from("knowledge_sources").delete({ count: "exact" }).eq("is_test", true);
    if (error) return Response.json({ error: `テスト用サンプルを消せませんでした: ${error.message}` }, { status: 500 });
    return Response.json({ ok: true, deleted: count ?? 0 });
  }

  const v = body.item;
  const rows = buildChunkRows(v);

  // 先に埋め込みを作る(失敗したら DB は触らない)。VOYAGE_API_KEY が無ければ文字列検索だけで動く
  const vectors: (number[] | null)[] = [];
  for (let i = 0; i < rows.length; i += 64) {
    const batch = await embedTexts(rows.slice(i, i + 64).map((r) => r.content), "document");
    vectors.push(...(batch ?? rows.slice(i, i + 64).map(() => null)));
  }

  const del = await admin.from("knowledge_sources").delete().eq("kind", "youtube").eq("url", v.url);
  if (del.error) return Response.json({ error: `前のデータを消せませんでした: ${del.error.message}` }, { status: 500 });

  const { data: src, error } = await admin
    .from("knowledge_sources")
    .insert({ kind: "youtube", title: v.title, url: v.url, published_at: v.published_at ?? null, is_test: false })
    .select("id")
    .single();
  if (error || !src) return Response.json({ error: `動画を登録できませんでした: ${error?.message}` }, { status: 500 });

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
      return Response.json({ error: `本文を登録できませんでした: ${cErr.message}` }, { status: 500 });
    }
  }
  return Response.json({ ok: true, chunks: rows.length, embedded: vectors.some(Boolean) });
}
