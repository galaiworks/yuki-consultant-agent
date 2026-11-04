/**
 * クライアントを登録する。
 *   仮パスワードで登録(メール送信なし。表示されたパスワードを本人に伝える):
 *     npm run client:invite -- --email client@example.com --name "山田 太郎" --company "山田商事"
 *   招待メールで登録(メール送信サービスの設定が必要):
 *     npm run client:invite -- --email client@example.com --send-email
 *   管理者として登録: --admin を付ける
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { appConfig } from "../src/lib/config";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    company: { type: "string" },
    admin: { type: "boolean", default: false },
    "send-email": { type: "boolean", default: false },
  },
});
if (!values.email) throw new Error("--email を指定してください");

const supabase = createSupabaseAdminClient();
let userId: string;
let tempPassword: string | null = null;

if (values["send-email"]) {
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(values.email, {
    redirectTo: `${appConfig.siteUrl}/auth/callback`,
  });
  if (error) throw new Error(`招待に失敗しました: ${error.message}`);
  userId = data.user.id;
} else {
  tempPassword = randomBytes(12).toString("base64url");
  const { data, error } = await supabase.auth.admin.createUser({
    email: values.email,
    password: tempPassword,
    email_confirm: true,
  });
  if (error) throw new Error(`登録に失敗しました: ${error.message}`);
  userId = data.user.id;
}

const { error: pErr } = await supabase
  .from("profiles")
  .update({
    display_name: values.name ?? null,
    company_name: values.company ?? null,
    role: values.admin ? "admin" : "client",
  })
  .eq("id", userId);
if (pErr) throw new Error(`プロフィールの更新に失敗しました: ${pErr.message}`);

console.log(`登録しました: ${values.email}${values.admin ? "(管理者)" : ""}`);
if (tempPassword) {
  console.log(`仮パスワード: ${tempPassword}`);
  console.log(`ログイン: ${appConfig.siteUrl}/login → ログイン後「アカウント」で変更してもらってください。`);
}
