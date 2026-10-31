import type Stripe from "stripe";
import { getStripe, syncStripeSubscription } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/config";

export const runtime = "nodejs";

/** Stripe からの通知でサブスク状態を同期する */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncStripeSubscription(admin, event.data.object);
      break;
    case "checkout.session.completed": {
      const session = event.data.object;
      if (typeof session.subscription === "string") {
        await syncStripeSubscription(admin, await stripe.subscriptions.retrieve(session.subscription));
      }
      break;
    }
    default:
      break;
  }
  return Response.json({ received: true });
}
