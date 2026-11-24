"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { normalizeLoginCode, LOGIN_CODE_PATTERN, sendErrorMessage } from "@/lib/login-code";

/** email: メールアドレスを入れる / code: 届いた数字を入れる */
type Step = "email" | "code";

/**
 * ログイン画面。「メールアドレス → メールに届く 6 桁のコード」の 1 通りに統一する(パスワードは使わない)。
 */
export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // コードを送った先。表示・確認・再送はこのアドレスを使い、入力欄を後から変えてもずれないようにする
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  // 古い方式のリンク(/auth/callback)で失敗して戻ってきたときは、理由を表示する
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "link") {
      setError("メールのリンクでログインできませんでした。もう一度コードを送り、メールに書かれた数字を入力してください。");
    }
  }, []);

  /** ログイン用のコードをメールで送る。メールのリンクも、どのブラウザで開いても通るようにする */
  async function sendCode(to: string) {
    setBusy(true);
    setError("");
    setInfo("");
    // implicit 方式のクライアントで送る。PKCE だと、メールのリンクが「申し込んだブラウザ」でしか通らないため
    const linkClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error: err } = await linkClient.auth.signInWithOtp({
      email: to,
      options: {
        // 登録済みの人だけ(新規登録はチケットコードの画面から)
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });
    setBusy(false);
    if (err) {
      setError(sendErrorMessage(err));
      return;
    }
    setSentTo(to);
    setCode("");
    setStep("code");
    setInfo(`${to} に、ログイン用の 6 桁の数字を送りました。メールを開いて、数字を入力してください。`);
  }

  /** 届いたコードを確かめてログインする */
  async function verifyCode() {
    const token = normalizeLoginCode(code);
    if (!LOGIN_CODE_PATTERN.test(token)) {
      setError("メールに書かれた 6 桁の数字を入力してください。");
      return;
    }
    setBusy(true);
    setError("");
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.verifyOtp({ email: sentTo, token, type: "email" });
    if (err) {
      setBusy(false);
      setError("数字が違うか、期限が切れています。いちばん新しいメールの数字を入力するか、「コードを送り直す」を押してください。");
      return;
    }
    router.replace("/chat");
    router.refresh();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step === "email") void sendCode(email.trim());
    else void verifyCode();
  }

  function goTo(next: Step) {
    setStep(next);
    setError("");
    setInfo("");
  }

  const submitLabel = busy ? "確認中…" : step === "email" ? "ログインコードを送る" : "ログイン";

  return (
    <main className="shell login-shell">
      <div className="login-hero">
        <img className="login-portrait" src="/yuki/portrait.jpg" alt="YUKI" width={900} height={900} fetchPriority="high" />
      </div>
      <section className="login-content" aria-labelledby="login-title">
        <h1 className="login-brand" id="login-title">YUKI<small className="brand-kicker">AI CONSULTANT · LOS ANGELES</small></h1>
        <p className="muted login-intro">
          {step === "code"
            ? "メールに届いた数字を入力すると、ログインできます。"
            : "登録したメールアドレスを入れると、ログイン用の 6 桁の数字がメールで届きます。パスワードは要りません。"}
        </p>
        <form className="card login-form" onSubmit={onSubmit}>
          <label className="login-field" htmlFor="email">
            <span className="field-label"><span lang="en">Email</span> メールアドレス</span>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoComplete="email"
              value={step === "code" ? sentTo : email}
              readOnly={step === "code" || busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {step === "code" && (
            <label className="login-field" htmlFor="code">
              <span className="field-label"><span lang="en">Code</span> メールに届いた 6 桁の数字</span>
              <input
                id="code"
                className="login-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(normalizeLoginCode(e.target.value))}
              />
            </label>
          )}
          <button className="login-submit" type="submit" disabled={busy}>{submitLabel}</button>
          {info && <p role="status">{info}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {step === "code" && (
            <div className="login-links">
              <button type="button" className="secondary" disabled={busy} onClick={() => void sendCode(sentTo)}>コードを送り直す</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => goTo("email")}>メールアドレスを直す</button>
            </div>
          )}
        </form>
        <p className="muted">はじめての方は、チケットコードで <a href="/signup">新規登録</a> してください。</p>
        <p className="notice login-notice">このサービスの YUKI は、本人の動画と考え方をもとに作られた AI です(本人公認)。</p>
      </section>
    </main>
  );
}
