import { z } from "zod";
import { currentUserIsAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PersonaLineSchema, VideoLineSchema } from "@/lib/knowledge/bundle";
import { clearTestSamples, importPersona, importVideo, knowledgeTablesReady } from "@/lib/knowledge/import";
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

  // 素材をクライアントから読めなくする SQL が入るまでは取り込まない(社外秘のため)
  if (!(await knowledgeTablesReady(admin))) {
    return Response.json(
      { error: "先に Supabase で supabase/pending.sql を実行してください" },
      { status: 409 },
    );
  }

  try {
    if (body.action === "persona") {
      await importPersona(admin, body.items, user.id);
      clearPersonaCache();
      return Response.json({ ok: true, saved: body.items.map((p) => p.key) });
    }
    if (body.action === "clear_test") {
      return Response.json({ ok: true, deleted: await clearTestSamples(admin) });
    }
    const r = await importVideo(admin, body.item);
    return Response.json({ ok: true, ...r });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
