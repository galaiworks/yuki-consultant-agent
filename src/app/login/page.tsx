"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Mode = "password" | "link";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createSupabaseBrowserClient();

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setState("error");
        setMessage("メールアドレスかパスワードが違います。");
        return;
      }
      router.replace("/chat");
      router.refresh();
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // 招待済みのクライアントだけがログインできる(新規登録はさせない)
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setState("error");
      setMessage("このメールアドレスは登録されていません。招待メールのアドレスでお試しください。");
      return;
    }
    setState("sent");
  }

  function switchMode(next: Mode) {
    setMode(next);
    setState("idle");
    setMessage("");
  }

  return (
    <main className="shell" style={{ maxWidth: 480 }}>
      <h1>YUKI Consultant Agent</h1>
      <p className="muted">クライアント限定の AI 経営相談です。担当者からお知らせしたメールアドレスでログインしてください。</p>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="email">
          メールアドレス
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === "password" && (
          <label htmlFor="password">
            パスワード
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "確認中…" : mode === "password" ? "ログイン" : "ログインリンクを送る"}
        </button>
        {state === "sent" && <p>ログイン用のリンクを送りました。メールを確認してください。</p>}
        {state === "error" && <p className="error">{message}</p>}
        <button
          type="button"
          className="secondary"
          onClick={() => switchMode(mode === "password" ? "link" : "password")}
        >
          {mode === "password" ? "メールのリンクでログインする" : "パスワードでログインする"}
        </button>
      </form>
      <p className="notice">このサービスの回答は AI が作成しています。YUKI さん本人の回答ではありません。</p>
    </main>
  );
}
