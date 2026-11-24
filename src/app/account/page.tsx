import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Nav } from "@/app/nav";
import { PasswordForm } from "@/app/account/password-form";
import { InsightsConsentForm } from "@/app/account/insights-form";

export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const profile = await supabase.from("profiles").select("insights_consent").eq("id", user.id).single();

  return (
    <main className="shell" style={{ maxWidth: 560 }}>
      <Nav />
      <h1>アカウント</h1>
      <p className="muted">{user.email}</p>
      <PasswordForm />
      {profile.error ? <p className="error">相談の傾向の同意設定を読み込めませんでした。時間をおいて再度お試しください。</p>
        : <InsightsConsentForm consent={profile.data?.insights_consent === true} />}
    </main>
  );
}
