"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createSupabaseBrowserClient();
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

  return (
    <main className="shell" style={{ maxWidth: 480 }}>
      <h1>YUKI Consultant Agent</h1>
      <p className="muted">クライアント限定の AI 経営相談です。招待されたメールアドレスでログインしてください。</p>
      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="email">
          メールアドレス
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" disabled={state === "sending"}>{state === "sending" ? "送信中…" : "ログインリンクを送る"}</button>
        {state === "sent" && <p>ログイン用のリンクを送りました。メールを確認してください。</p>}
        {state === "error" && <p className="error">{message}</p>}
      </form>
      <p className="notice">このサービスの回答は AI が作成しています。YUKI さん本人の回答ではありません。</p>
    </main>
  );
}
