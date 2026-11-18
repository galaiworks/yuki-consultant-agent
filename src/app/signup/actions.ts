"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hashPassCode, REDEEM_ERRORS, slowDownAfterBadCode } from "@/lib/access";
import { appConfig } from "@/lib/config";
import { isReservedEmail, parseSignup, passProblem } from "@/lib/signup";

export type SignupState = { error?: string };

const FAILED = "登録できませんでした。時間をおいてもう一度お試しください。";

/**
 * 特別チケットのコードで新規登録し、そのままログインして相談画面へ進む。
 * 1. 入力とチケットを確かめる 2. メール確認済みの利用者を作る 3. ログインする 4. チケットを使う
 * 3・4 で失敗したら、作った利用者を消して元に戻す(コードを使わずに利用者だけ残さないため)
 */
export async function signUpWithPass(_prev: SignupState, form: FormData): Promise<SignupState> {
  const parsed = parseSignup({
    code: form.get("code") ?? "",
    email: form.get("email") ?? "",
    name: form.get("name") || undefined,
    password: form.get("password") ?? "",
    confirm: form.get("confirm") ?? "",
  });
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;
  const codeHash = hashPassCode(v.code);
  if (isReservedEmail(v.email, appConfig.adminEmails)) return { error: "このメールアドレスでは登録できません。担当者にお問い合わせください。" };

  const admin = createSupabaseAdminClient();
  const { data: pass } = await admin
    .from("access_passes")
    .select("revoked_at, expires_at, redemption_count, max_redemptions")
    .eq("code_hash", codeHash)
    .maybeSingle();
  const problem = passProblem(pass, new Date());
  if (problem) {
    await slowDownAfterBadCode();
    return { error: REDEEM_ERRORS[problem] ?? FAILED };
  }

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: v.email,
    password: v.password,
    email_confirm: true,
    // チケットの引き換えが済むまでは使えない印。途中で失敗して利用者が残っても、相談はできない
    app_metadata: { signup_pending: true },
  });
  if (cErr || !created.user) {
    return {
      error: cErr?.message.includes("already")
        ? "このメールアドレスはすでに登録されています。ログイン画面からお入りください。"
        : FAILED,
    };
  }
  const userId = created.user.id;

  // 失敗したら作った利用者を消す。消せなかったときは利用停止にして記録を残す。
  // どちらも失敗しても「登録途中」の印が残るので、相談はできない(管理画面から確認・削除する)
  const undo = async () => {
    try {
      const { error: dErr } = await admin.auth.admin.deleteUser(userId);
      if (!dErr) return;
      const { error: bErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      console.error("signup: 登録の取り消しに失敗(登録途中の印つきで残っています)", { userId, deleteError: dErr.message, banError: bErr?.message ?? null });
    } catch (e) {
      console.error("signup: 登録の取り消しで例外(登録途中の印つきで残っています)", { userId, error: String(e) });
    }
  };

  // チケットの引き換えが済んだあとは、失敗しても利用者を消さない(使用済みのチケットと利用権を失わせないため)
  let redeemed = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { error: sErr } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
    if (sErr) {
      await undo();
      return { error: FAILED };
    }

    const { error: rErr } = await supabase.rpc("redeem_access_pass", { p_code_hash: codeHash });
    if (rErr) {
      await supabase.auth.signOut().catch(() => undefined);
      await undo();
      const key = Object.keys(REDEEM_ERRORS).find((k) => rErr.message.includes(k));
      return { error: key ? REDEEM_ERRORS[key] : FAILED };
    }

    redeemed = true;

    // 引き換えが済んだので「登録途中」の印を外す。外せなければ、チケットは使用済みのまま管理者が対応する
    const { error: uErr } = await admin.auth.admin.updateUserById(userId, { app_metadata: { signup_pending: false } });
    if (uErr) {
      console.error("signup: 登録途中の印を外せませんでした", { userId, error: uErr.message });
      return { error: "登録の最後の手続きに失敗しました。お手数ですが担当者にお問い合わせください。" };
    }
    // セッションに新しい印を反映する(古いトークンの印のまま判定されないように)
    await supabase.auth.refreshSession();

    if (v.name) {
      await admin.from("profiles").update({ display_name: v.name }).eq("id", userId);
    }
    if (form.get("insightsConsent") === "on") {
      // 登録完了後、本人の RLS で明示された同意だけを保存する。日時は DB が設定する。
      const consent = await supabase.from("profiles").update({ insights_consent: true }).eq("id", userId)
        .select("insights_consent").single();
      if (consent.error || consent.data?.insights_consent !== true) {
        return { error: "登録は完了しましたが、相談の傾向の同意設定を保存できませんでした。同意しない状態です。ログイン後、アカウント画面で設定してください。" };
      }
    }
  } catch (e) {
    if (!redeemed) {
      await undo();
      console.error("signup: 登録の途中で失敗", e);
      return { error: FAILED };
    }
    console.error("signup: チケットの引き換え後に失敗(利用者は残しています)", { userId, error: String(e) });
    return { error: "登録の最後の手続きに失敗しました。お手数ですが担当者にお問い合わせください。" };
  }
  redirect("/chat");
}
