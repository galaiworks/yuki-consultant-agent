import Link from "next/link";
import { SignupForm } from "@/app/signup/signup-form";

/** 特別チケットのコードを受け取った人が、自分で登録する画面 */
export default function SignupPage() {
  return (
    <main className="shell login-shell">
      <div className="login-hero">
        <img className="login-portrait" src="/yuki/portrait.jpg" alt="YUKI" width={900} height={900} fetchPriority="high" />
      </div>
      <section className="login-content" aria-labelledby="signup-title">
        <h1 className="login-brand" id="signup-title">YUKI<small className="brand-kicker">AI CONSULTANT · LOS ANGELES</small></h1>
        <p className="muted login-intro">担当者から受け取ったチケットコードと、ふだんお使いのメールアドレスで登録します。パスワードは要りません。登録するとすぐに使えます。次からは、メールに届く 6 桁の数字でログインします。</p>
        <SignupForm />
        <p className="muted">すでに登録済みの方は <Link href="/login">ログイン</Link> へ。</p>
        <p className="notice login-notice">このサービスの YUKI は、本人の動画と考え方をもとに作られた AI です(本人公認)。</p>
      </section>
    </main>
  );
}
