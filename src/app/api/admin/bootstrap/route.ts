import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateTempPassword } from "@/lib/admin/temp-password";
import { appConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findAuthUserByEmail(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<{ id: string } | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

function tokenMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 最初の管理者を 1 回だけ作る。
 * - 環境変数 BOOTSTRAP_TOKEN(32 文字以上)と ADMIN_EMAILS を設定したときだけ動く
 * - 管理者が 1 人でもいれば何もしない
 * - 使い終わったら BOOTSTRAP_TOKEN を消す
 */
export async function GET(req: Request) {
  const expected = process.env.BOOTSTRAP_TOKEN;
  if (!expected || expected.length < 32) return new Response("not found", { status: 404 });
  if (!tokenMatches(new URL(req.url).searchParams.get("token"), expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const email = appConfig.adminEmails[0];
  if (!email) return Response.json({ error: "ADMIN_EMAILS が設定されていません" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { count, error: cErr } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if (cErr) return Response.json({ error: cErr.message }, { status: 500 });
  if ((count ?? 0) > 0) return Response.json({ error: "すでに管理者がいます" }, { status: 409 });

  const password = generateTempPassword();
  // profiles.email は本人が書き換えられるので、認証済みのメール(auth.users)で探す
  const existing = await findAuthUserByEmail(admin, email);

  let userId: string;
  if (existing) {
    userId = existing.id as string;
    const { error } = await admin.auth.admin.updateUserById(userId, { password, user_metadata: { must_change_password: true } });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    userId = data.user.id;
  }

  const { error: rErr } = await admin.from("profiles").update({ role: "admin" }).eq("id", userId);
  if (rErr) return Response.json({ error: rErr.message }, { status: 500 });

  return Response.json(
    { email, tempPassword: password, next: "ログイン後すぐに「アカウント」でパスワードを変更し、BOOTSTRAP_TOKEN を消してください" },
    { headers: { "cache-control": "no-store" } },
  );
}
