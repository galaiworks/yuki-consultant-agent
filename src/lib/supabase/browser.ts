"use client";

import { createBrowserClient } from "@supabase/ssr";

/** ブラウザ用クライアント(ログイン画面のみで使用) */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
