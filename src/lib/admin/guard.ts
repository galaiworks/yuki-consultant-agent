import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/access";
import { appConfig } from "@/lib/config";

/** ログイン中のユーザーが管理者かどうか */
export async function currentUserIsAdmin(): Promise<{ user: User | null; isAdmin: boolean }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, isAdmin: false };
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return { user, isAdmin: isAdminUser(data?.role, user.email, appConfig.adminEmails) };
}

/**
 * 管理者だけが通れる。通ったら service role のクライアントを返す。
 * 管理画面のデータ読み書きはすべてこれを通す。
 */
export async function requireAdmin() {
  const { user, isAdmin } = await currentUserIsAdmin();
  if (!user) redirect("/login");
  if (!isAdmin) redirect("/chat");
  return { user, admin: createSupabaseAdminClient() };
}
