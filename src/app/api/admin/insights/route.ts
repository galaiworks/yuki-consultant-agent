import { currentUserIsAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runInsightExtraction } from "@/lib/insights/extract";

export const runtime = "nodejs";
export const maxDuration = 240;

/** 管理者の明示的なボタン操作でだけ実行する。定期実行や回答への自動反映はしない。 */
export async function POST() {
  const { user, isAdmin } = await currentUserIsAdmin();
  if (!user || !isAdmin) return Response.json({ error: "管理者だけが使えます" }, { status: 403 });
  try {
    return Response.json(await runInsightExtraction(createSupabaseAdminClient(), user.id), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "傾向をまとめられませんでした。設定を確認してから再実行してください。" }, { status: 500 });
  }
}
