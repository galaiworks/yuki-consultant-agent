import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/agents/client";
import { appConfig, MODELS } from "@/lib/config";

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
  // あると良いもの(無くても動くので ok の判定には入れない)
  const optional = {
    voice: appConfig.voiceEnabled,
    embeddings: Boolean(process.env.VOYAGE_API_KEY),
  };

  let database: string;
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin.from("plans").select("id", { count: "exact", head: true });
    // head リクエストはテーブルが無くてもエラーにならないので、本文ありで確かめる
    const feedback = await admin.from("message_feedback").select("id").limit(1);
    database = error ? `error: ${error.code ?? "unknown"}` : `ok (plans=${count}, feedback_table=${feedback.error ? "missing" : "ok"})`;
  } catch {
    database = "error: not configured";
  }

  // YUKI さんのデータが取り込まれたか(件数だけ。中身は返さない)
  let knowledge: Record<string, number | string>;
  try {
    const admin = createSupabaseAdminClient();
    const count = async (q: PromiseLike<{ count: number | null; error: { code?: string } | null }>) => {
      const { count: n, error } = await q;
      return error ? `error: ${error.code ?? "unknown"}` : (n ?? 0);
    };
    const [personaLayers, videos, testSamples, chunks, embedded] = await Promise.all([
      count(admin.from("persona_layers").select("key", { count: "exact", head: true })),
      count(admin.from("knowledge_sources").select("id", { count: "exact", head: true }).eq("is_test", false)),
      count(admin.from("knowledge_sources").select("id", { count: "exact", head: true }).eq("is_test", true)),
      count(admin.from("knowledge_chunks").select("id", { count: "exact", head: true })),
      count(admin.from("knowledge_chunks").select("id", { count: "exact", head: true }).not("embedding", "is", null)),
    ]);
    knowledge = { persona_layers: personaLayers, videos, test_samples: testSamples, chunks, embedded_chunks: embedded };
  } catch {
    knowledge = { error: "not configured" };
  }

  let claude: string;
  try {
    await anthropic().models.retrieve(MODELS.lead);
    claude = "ok";
  } catch (err) {
    claude = `error: ${err instanceof Error ? err.constructor.name : "unknown"}`;
  }

  const ok = Object.values(env).every(Boolean) && database.startsWith("ok") && claude === "ok";
  return Response.json({ ok, env, optional, database, knowledge, claude }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
