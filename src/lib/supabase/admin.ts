import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/config";

/**
 * service role の Supabase クライアント。RLS を越えるので
 * 利用料ログ・評価ログ・サブスク更新など、サーバー内部の書き込みだけに使う。
 */
export function createSupabaseAdminClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
