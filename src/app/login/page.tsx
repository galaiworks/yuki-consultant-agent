"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { normalizeLoginCode, LOGIN_CODE_PATTERN } from "@/lib/login-code";

/** email: メールアドレスを入れる / code: 届いた数字を入れる / password: パスワードをお持ちの方 */
type Step = "email" | "code" | "password";

/**
 * ログイン画面。基本は「メールアドレス → メールに届く 6 桁のコード」で入る(パスワードを覚えなくてよい)。
 * 以前に決めたパスワードがある人のために、パスワードでも入れる道を小さく残す。
 */
export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
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
  async function sendCode() {
    setBusy(true);
    setError("");
    setInfo("");
    // implicit 方式のクライアントで送る。PKCE だと、メールのリンクが「申し込んだブラウザ」でしか通らないため
    const linkClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error: err } = await linkClient.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // 登録済みの人だけ(新規登録はチケットコードの画面から)
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });
    setBusy(false);
    if (err) {
      setError(
        err.status === 429
          ? "続けて送りすぎました。1 分ほど待ってから、もう一度お試しください。"
          : "このメールアドレスは登録されていません。登録がまだの方は、下の「新規登録」からお進みください。",
      );
      return;
    }
    setCode("");
    setStep("code");
    setInfo(`${email.trim()} に、ログイン用の 6 桁の数字を送りました。メールを開いて、数字を入力してください。`);
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
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    if (err) {
      setBusy(false);
      setError("数字が違うか、期限が切れています。いちばん新しいメールの数字を入力するか、「コードを送り直す」を押してください。");
      return;
    }
    router.replace("/chat");
    router.refresh();
  }

  async function signInWithPassword() {
    setBusy(true);
    setError("");
    const { error: err } = await createSupabaseBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setBusy(false);
      setError("メールアドレスかパスワードが違います。パスワードがわからないときは「メールのコードでログインする」をお使いください。");
      return;
    }
    router.replace("/chat");
    router.refresh();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step === "email") void sendCode();
    else if (step === "code") void verifyCode();
    else void signInWithPassword();
  }

  function goTo(next: Step) {
    setStep(next);
    setError("");
    setInfo("");
  }

  const submitLabel = busy
    ? "確認中…"
    : step === "email" ? "ログインコードを送る" : step === "code" ? "ログイン" : "パスワードでログイン";

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
              value={email}
              readOnly={step === "code"}
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
                pattern="[0-9 ]*"
                maxLength={12}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          {step === "password" && (
            <label className="login-field" htmlFor="password">
              <span className="field-label"><span lang="en">Password</span> パスワード</span>
              <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          <button className="login-submit" type="submit" disabled={busy}>{submitLabel}</button>
          {info && <p role="status">{info}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {step === "code" && (
            <div className="login-links">
              <button type="button" className="secondary" disabled={busy} onClick={() => void sendCode()}>コードを送り直す</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => goTo("email")}>メールアドレスを直す</button>
            </div>
          )}
          {step === "password" ? (
            <button type="button" className="secondary" onClick={() => goTo("email")}>メールのコードでログインする</button>
          ) : step === "email" ? (
            <button type="button" className="login-text-link" onClick={() => goTo("password")}>パスワードをお持ちの方はこちら</button>
          ) : null}
        </form>
        <p className="muted">はじめての方は、チケットコードで <a href="/signup">新規登録</a> してください。</p>
        <p className="notice login-notice">このサービスの YUKI は、本人の動画と考え方をもとに作られた AI です(本人公認)。</p>
      </section>
    </main>
  );
}
