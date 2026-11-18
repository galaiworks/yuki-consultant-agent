import { currentUserIsAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listInsightTopics } from "@/lib/insights/topics";
import { exportInsightMarkdown } from "@/lib/insights/privacy";

export const dynamic = "force-dynamic";

/** 5 人以上で承認済みの匿名ナレッジだけを、ダウンロードの都度読み直す。 */
export async function GET() {
  const { user, isAdmin } = await currentUserIsAdmin();
  if (!user || !isAdmin) return Response.json({ error: "管理者だけが使えます" }, { status: 403 });
  try {
    const topics = await listInsightTopics(createSupabaseAdminClient(), true);
    return new Response(exportInsightMarkdown(topics), { headers: {
      "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": 'attachment; filename="student-insights.md"',
      "Cache-Control": "private, no-store",
    } });
  } catch {
    return Response.json({ error: "書き出せませんでした。時間をおいて再度お試しください。" }, { status: 500 });
  }
}
