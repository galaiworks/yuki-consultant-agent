/**
 * 特別チケットを発行する。
 *   npm run pass:create -- --plan founding --days 30 --uses 1 --label "YUKIさん紹介枠"
 * コードはこの画面にだけ表示され、DB にはハッシュだけが保存される。
 */
import { parseArgs } from "node:util";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { generatePassCode, hashPassCode } from "../src/lib/access";

const { values } = parseArgs({
  options: {
    plan: { type: "string", default: "founding" },
    days: { type: "string", default: "30" },
    uses: { type: "string", default: "1" },
    count: { type: "string", default: "1" },
    label: { type: "string" },
    "expires-in-days": { type: "string" },
  },
});

const admin = createSupabaseAdminClient();
const expiresAt = values["expires-in-days"]
  ? new Date(Date.now() + Number(values["expires-in-days"]) * 86_400_000).toISOString()
  : null;

for (let i = 0; i < Number(values.count); i++) {
  const code = generatePassCode();
  const { error } = await admin.from("access_passes").insert({
    code_hash: hashPassCode(code),
    label: values.label ?? null,
    plan_id: values.plan,
    duration_days: Number(values.days),
    max_redemptions: Number(values.uses),
    expires_at: expiresAt,
  });
  if (error) throw new Error(`発行に失敗しました: ${error.message}`);
  console.log(code);
}
console.error(`プラン ${values.plan} / ${values.days} 日間 / ${values.uses} 回まで で発行しました。コードは再表示できません。`);
