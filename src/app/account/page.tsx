import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Nav } from "@/app/nav";
import { PasswordForm } from "@/app/account/password-form";

export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="shell" style={{ maxWidth: 560 }}>
      <Nav />
      <h1>アカウント</h1>
      <p className="muted">{user.email}</p>
      <PasswordForm />
    </main>
  );
}
