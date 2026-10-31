import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appConfig, type AccessMode } from "@/lib/config";

export type SubscriptionRow = {
  plan_id: string;
  source: "stripe" | "access_pass" | "admin";
  status: "active" | "trialing" | "past_due" | "canceled" | "expired";
  current_period_end: string | null;
};

export type PlanRow = { id: string; name: string; monthly_usage_limit_usd: number };

export type AccessDecision =
  | { allowed: true; planId: string; source: "open" | SubscriptionRow["source"] | "admin_role"; limitUsd: number | null }
  | { allowed: false; reason: "no_subscription" | "usage_limit_reached"; planId?: string; limitUsd?: number };

/**
 * 利用可否を決める純粋関数(テスト対象)。
 * - 管理者は常に利用可(上限なし)
 * - open モード: 招待済みユーザーは既定プランで利用可
 * - paid モード: 有効なサブスク(Stripe / チケット / 管理者付与)が必要
 * - どちらのモードでも、月間の API 費用上限を超えたら止める
 */
export function decideAccess(input: {
  mode: AccessMode;
  isAdmin: boolean;
  subscriptions: SubscriptionRow[];
  plans: PlanRow[];
  defaultPlanId: string;
  usageThisMonthUsd: number;
  now: Date;
}): AccessDecision {
  if (input.isAdmin) {
    return { allowed: true, planId: "admin", source: "admin_role", limitUsd: null };
  }

  const active = input.subscriptions
    .filter((s) => s.status === "active" || s.status === "trialing")
    .filter((s) => !s.current_period_end || new Date(s.current_period_end) > input.now);

  const planOf = (id: string) => input.plans.find((p) => p.id === id);

  // 有効なサブスクの中で上限が最も大きいプランを採用
  const best = active
    .map((s) => ({ s, plan: planOf(s.plan_id) }))
    .filter((x): x is { s: SubscriptionRow; plan: PlanRow } => Boolean(x.plan))
    .sort((a, b) => Number(b.plan.monthly_usage_limit_usd) - Number(a.plan.monthly_usage_limit_usd))[0];

  let planId: string;
  let source: "open" | SubscriptionRow["source"];
  let limitUsd: number;

  if (best) {
    planId = best.plan.id;
    source = best.s.source;
    limitUsd = Number(best.plan.monthly_usage_limit_usd);
  } else if (input.mode === "open") {
    const plan = planOf(input.defaultPlanId);
    if (!plan) return { allowed: false, reason: "no_subscription" };
    planId = plan.id;
    source = "open";
    limitUsd = Number(plan.monthly_usage_limit_usd);
  } else {
    return { allowed: false, reason: "no_subscription" };
  }

  if (input.usageThisMonthUsd >= limitUsd) {
    return { allowed: false, reason: "usage_limit_reached", planId, limitUsd };
  }
  return { allowed: true, planId, source, limitUsd };
}

/** ログイン中ユーザーの利用可否を DB から判定する */
export async function getAccessForCurrentUser(supabase: SupabaseClient, userId: string): Promise<AccessDecision> {
  const [profile, subs, plans, usage] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", userId).single(),
    supabase.from("subscriptions").select("plan_id, source, status, current_period_end").eq("user_id", userId),
    supabase.from("plans").select("id, name, monthly_usage_limit_usd").eq("is_active", true),
    supabase.rpc("my_usage_this_month"),
  ]);
  for (const r of [profile, subs, plans, usage]) {
    if (r.error) throw new Error(`利用権の確認に失敗しました: ${r.error.message}`);
  }
  return decideAccess({
    mode: appConfig.accessMode,
    isAdmin: profile.data?.role === "admin",
    subscriptions: (subs.data ?? []) as SubscriptionRow[],
    plans: (plans.data ?? []) as PlanRow[],
    defaultPlanId: appConfig.defaultPlanId,
    usageThisMonthUsd: Number(usage.data ?? 0),
    now: new Date(),
  });
}

/** チケットコードの表記ゆれ(空白・ハイフン・小文字)をそろえる */
export function normalizePassCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** DB に保存するのはコードのハッシュだけ */
export function hashPassCode(code: string): string {
  return createHash("sha256").update(normalizePassCode(code)).digest("hex");
}

/** 読み間違えやすい文字(0/O, 1/I)を除いた 16 文字のコードを作る。表示は 4 文字区切り */
export function generatePassCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let raw = "";
  for (const b of bytes) raw += alphabet[b % alphabet.length];
  return raw.match(/.{4}/g)!.join("-");
}

export const REDEEM_ERRORS: Record<string, string> = {
  pass_not_found: "このコードは見つかりませんでした。入力内容を確認してください。",
  pass_revoked: "このコードは無効になっています。担当者にお問い合わせください。",
  pass_expired: "このコードは有効期限が切れています。",
  pass_used_up: "このコードは利用上限に達しています。",
  pass_already_redeemed: "このコードはすでに利用済みです。",
  not_authenticated: "ログインしてから入力してください。",
};
