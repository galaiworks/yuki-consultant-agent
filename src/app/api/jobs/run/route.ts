import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processNextDeliverable } from "@/lib/agents/deliverable-loop";

export const runtime = "nodejs";
// Vercel Hobby の上限(300 秒)に合わせている。Pro にしたら 800 まで延ばせる
export const maxDuration = 300;

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
  // 時間制限内に収まるよう、1 回の起動で 1 件
  for (let i = 0; i < 1; i++) {
    const n = await processNextDeliverable(admin);
    if (n === 0) break;
    processed += n;
  }
  return Response.json({ processed });
}
