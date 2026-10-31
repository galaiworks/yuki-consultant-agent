import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig } from "@/lib/config";
import { Nav } from "@/app/nav";
import { CheckoutButton } from "@/app/billing/checkout-button";

const SOURCE_LABEL: Record<string, string> = {
  open: "テスト期間の無料利用",
  stripe: "オンライン決済",
  access_pass: "特別チケット",
  admin: "管理者付与",
  admin_role: "管理者",
};

export default async function BillingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [access, plans, subs, usage] = await Promise.all([
    getAccessForCurrentUser(supabase, user.id),
    supabase.from("plans").select("id, name, stripe_price_id").eq("is_active", true),
    supabase.from("subscriptions").select("plan_id, source, status, current_period_end").order("created_at", { ascending: false }),
    supabase.rpc("my_usage_this_month"),
  ]);

  return (
    <main className="shell">
      <Nav />
      <h1>プラン</h1>
      <section className="card">
        <h2 style={{ fontSize: 18 }}>現在のご利用</h2>
        {access.allowed ? (
          <p>
            {SOURCE_LABEL[access.source] ?? access.source}({access.planId})
          </p>
        ) : (
          <p className="error">{access.reason === "usage_limit_reached" ? "今月の利用上限に達しています。" : "有効なプランがありません。"}</p>
        )}
        <p className="muted">今月の利用額: ${Number(usage.data ?? 0).toFixed(2)}</p>
        {(subs.data ?? []).map((s, i) => (
          <p key={i} className="muted" style={{ fontSize: 13 }}>
            {s.plan_id} / {SOURCE_LABEL[s.source] ?? s.source} / {s.status}
            {s.current_period_end ? ` / ${new Date(s.current_period_end).toLocaleDateString("ja-JP")} まで` : ""}
          </p>
        ))}
      </section>
      <section className="card">
        <h2 style={{ fontSize: 18 }}>プランを申し込む</h2>
        {appConfig.stripeEnabled ? (
          (plans.data ?? [])
            .filter((p) => p.stripe_price_id)
            .map((p) => <CheckoutButton key={p.id} planId={p.id} label={`${p.name} を申し込む`} />)
        ) : (
          <p className="muted">オンライン決済は準備中です。特別チケットをお持ちの方は <a href="/redeem">こちら</a> から入力してください。</p>
        )}
      </section>
    </main>
  );
}
