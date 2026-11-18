"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ConsentState = { ok?: string; error?: string };

/** 本人の RLS で同意だけを変更する。取り消し時の削除と再集計は DB トリガーで不可分に行う。 */
export async function updateInsightsConsent(_prev: ConsentState, form: FormData): Promise<ConsentState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: "ログインし直してください。" };
  const consent = form.get("insightsConsent") === "on";
  const { data, error } = await supabase.from("profiles").update({ insights_consent: consent }).eq("id", user.id)
    .select("insights_consent").single();
  if (error || data?.insights_consent !== consent) return { error: "同意の設定を保存できませんでした。時間をおいて再度お試しください。" };
  revalidatePath("/account");
  revalidatePath("/admin");
  return { ok: consent ? "同意の設定を保存しました。" : "同意を取り消し、あなたを元にした集計の記録を削除しました。" };
}
