import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/agents/client";
import { MODELS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 本番の設定がそろっているかを確かめる。値そのものは返さない。
 * Anthropic はモデル情報の取得だけ(料金はかからない)。
 */
export async function GET() {
  const env = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnon: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseService: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    cron: Boolean(process.env.CRON_SECRET),
  };

  let database: string;
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin.from("plans").select("id", { count: "exact", head: true });
    const feedback = await admin.from("message_feedback").select("id", { count: "exact", head: true });
    database = error ? `error: ${error.code ?? "unknown"}` : `ok (plans=${count}, feedback_table=${feedback.error ? "missing" : "ok"})`;
  } catch {
    database = "error: not configured";
  }

  let claude: string;
  try {
    await anthropic().models.retrieve(MODELS.lead);
    claude = "ok";
  } catch (err) {
    claude = `error: ${err instanceof Error ? err.constructor.name : "unknown"}`;
  }

  const ok = Object.values(env).every(Boolean) && database.startsWith("ok") && claude === "ok";
  return Response.json({ ok, env, database, claude }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
