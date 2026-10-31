import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/config";

let stripe: Stripe | null = null;

/** STRIPE_SECRET_KEY を設定したときだけ使う */
export function getStripe(): Stripe {
  stripe ??= new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  return stripe;
}

/** Stripe のサブスク状態を、この DB の status に変換する(テスト対象) */
export function mapStripeStatus(s: Stripe.Subscription.Status): "active" | "trialing" | "past_due" | "canceled" | "expired" {
  switch (s) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      // incomplete / incomplete_expired / paused
      return "expired";
  }
}

/** Stripe のサブスクを subscriptions 表に反映する */
export async function syncStripeSubscription(admin: SupabaseClient, sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .single();
  if (pErr || !profile) throw new Error(`Stripe 顧客 ${customerId} に対応するユーザーがいません`);

  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const { data: plan } = await admin.from("plans").select("id").eq("stripe_price_id", priceId).single();
  if (!plan) throw new Error(`Stripe price ${priceId} に対応するプランがありません`);

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: profile.id,
      plan_id: plan.id,
      source: "stripe",
      status: mapStripeStatus(sub.status),
      current_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
      stripe_subscription_id: sub.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
  if (error) throw new Error(`サブスクの保存に失敗しました: ${error.message}`);
}
