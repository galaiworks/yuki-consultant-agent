import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processNextDeliverable } from "@/lib/agents/deliverable-loop";

export const runtime = "nodejs";
// Writer と Guardian を最大 4 往復するため長めに取る(Vercel Pro 以上が前提)
export const maxDuration = 800;

/**
 * 取りこぼした成果物ジョブを処理する。Vercel Cron から呼ぶ。
 * Vercel Cron は Authorization: Bearer <CRON_SECRET> を付けて呼び出す。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  let processed = 0;
  // 時間制限内に収まるよう、1 回の起動で最大 2 件
  for (let i = 0; i < 2; i++) {
    const n = await processNextDeliverable(admin);
    if (n === 0) break;
    processed += n;
  }
  return Response.json({ processed });
}
