"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { generateTempPassword } from "@/lib/admin/temp-password";
import { generatePassCode, hashPassCode } from "@/lib/access";

export type ActionResult = { ok?: string; secret?: string; error?: string };

const ClientInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(100).optional(),
  company: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(100).optional(),
  role: z.enum(["client", "admin"]).default("client"),
});

/** クライアントを登録し、仮パスワードを一度だけ返す */
export async function createClientAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { admin } = await requireAdmin();
  const parsed = ClientInput.safeParse({
    email: form.get("email"),
    name: form.get("name") || undefined,
    company: form.get("company") || undefined,
    industry: form.get("industry") || undefined,
    role: form.get("role") || "client",
  });
  if (!parsed.success) return { error: "メールアドレスを正しく入力してください。" };
  const v = parsed.data;

  const password = generateTempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: v.email,
    password,
    email_confirm: true,
    user_metadata: { must_change_password: true },
  });
  if (error) {
    return { error: error.message.includes("already") ? "このメールアドレスはすでに登録されています。" : `登録できませんでした: ${error.message}` };
  }

  const { error: pErr } = await admin
    .from("profiles")
    .update({ display_name: v.name ?? null, company_name: v.company ?? null, industry: v.industry ?? null, role: v.role })
    .eq("id", data.user.id);
  if (pErr) return { error: `プロフィールを保存できませんでした: ${pErr.message}` };

  revalidatePath("/admin");
  return { ok: `${v.email} を登録しました。ログインURLと仮パスワードを本人に伝えてください。`, secret: password };
}

/** 仮パスワードを再発行する(パスワードを忘れたとき) */
export async function resetPasswordAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { admin } = await requireAdmin();
  const userId = z.string().uuid().safeParse(form.get("userId"));
  if (!userId.success) return { error: "対象が正しくありません。" };
  const password = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId.data, {
    password,
    user_metadata: { must_change_password: true },
  });
  if (error) return { error: `再発行できませんでした: ${error.message}` };
  return { ok: "仮パスワードを再発行しました。", secret: password };
}

const PassInput = z.object({
  plan: z.string().min(1),
  days: z.coerce.number().int().min(1).max(3650),
  uses: z.coerce.number().int().min(1).max(1000),
  label: z.string().trim().max(100).optional(),
});

/** 特別チケットを発行し、コードを一度だけ返す */
export async function createPassAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { admin } = await requireAdmin();
  const parsed = PassInput.safeParse({
    plan: form.get("plan"),
    days: form.get("days"),
    uses: form.get("uses"),
    label: form.get("label") || undefined,
  });
  if (!parsed.success) return { error: "入力内容を確認してください。" };
  const code = generatePassCode();
  const { error } = await admin.from("access_passes").insert({
    code_hash: hashPassCode(code),
    plan_id: parsed.data.plan,
    duration_days: parsed.data.days,
    max_redemptions: parsed.data.uses,
    label: parsed.data.label ?? null,
  });
  if (error) return { error: `発行できませんでした: ${error.message}` };
  revalidatePath("/admin");
  return { ok: "チケットを発行しました。コードは再表示できません。", secret: code };
}

/** 確認待ち・エスカレーションの成果物を承認して相談者に見せる */
export async function approveDeliverableAction(form: FormData): Promise<void> {
  const { admin } = await requireAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  await admin.from("deliverables").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin");
}
