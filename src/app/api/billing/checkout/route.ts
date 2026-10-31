import { z } from "zod";
import { appConfig } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/billing/stripe";

export const runtime = "nodejs";

const Body = z.object({ planId: z.string().min(1) });

/** Stripe Checkout を開始する。STRIPE_SECRET_KEY が無い間は 503 */
export async function POST(req: Request) {
  if (!appConfig.stripeEnabled) {
    return Response.json({ error: "オンライン決済は準備中です" }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "プランを指定してください" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  const { data: plan } = await supabase
    .from("plans")
    .select("id, stripe_price_id")
    .eq("id", parsed.data.planId)
    .eq("is_active", true)
    .single();
  if (!plan?.stripe_price_id) return Response.json({ error: "このプランはオンライン決済に対応していません" }, { status: 400 });

  const stripe = getStripe();
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from("profiles").select("stripe_customer_id, email").eq("id", user.id).single();

  let customerId = profile?.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: profile?.email ?? user.email, metadata: { user_id: user.id } });
    customerId = customer.id;
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: `${appConfig.siteUrl}/billing?status=success`,
    cancel_url: `${appConfig.siteUrl}/billing?status=canceled`,
  });
  return Response.json({ url: session.url });
}
