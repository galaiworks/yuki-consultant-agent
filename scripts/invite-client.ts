/**
 * クライアントを招待する(招待メールが届く)。
 *   npm run client:invite -- --email client@example.com --name "山田 太郎" --company "山田商事"
 */
import { parseArgs } from "node:util";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { appConfig } from "../src/lib/config";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    company: { type: "string" },
    admin: { type: "boolean", default: false },
  },
});
if (!values.email) throw new Error("--email を指定してください");

const supabase = createSupabaseAdminClient();
const { data, error } = await supabase.auth.admin.inviteUserByEmail(values.email, {
  redirectTo: `${appConfig.siteUrl}/auth/callback`,
});
if (error) throw new Error(`招待に失敗しました: ${error.message}`);

const { error: pErr } = await supabase
  .from("profiles")
  .update({
    display_name: values.name ?? null,
    company_name: values.company ?? null,
    role: values.admin ? "admin" : "client",
  })
  .eq("id", data.user.id);
if (pErr) throw new Error(`プロフィールの更新に失敗しました: ${pErr.message}`);
console.log(`招待しました: ${values.email}${values.admin ? "(管理者)" : ""}`);
