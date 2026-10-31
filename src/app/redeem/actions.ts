"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hashPassCode, normalizePassCode, REDEEM_ERRORS } from "@/lib/access";

export type RedeemState = { error?: string };

/** 特別チケットのコードを使う */
export async function redeemPass(_prev: RedeemState, formData: FormData): Promise<RedeemState> {
  const code = String(formData.get("code") ?? "");
  if (normalizePassCode(code).length < 8) return { error: "コードを正しく入力してください。" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("redeem_access_pass", { p_code_hash: hashPassCode(code) });
  if (error) {
    const key = Object.keys(REDEEM_ERRORS).find((k) => error.message.includes(k));
    return { error: key ? REDEEM_ERRORS[key] : "コードを使えませんでした。時間をおいて再度お試しください。" };
  }
  redirect("/chat");
}
