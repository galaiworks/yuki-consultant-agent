"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/** 最初にお渡しした仮パスワードを、自分のパスワードに変える */
export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      setState("error");
      setMessage("パスワードは 10 文字以上にしてください。");
      return;
    }
    if (password !== confirm) {
      setState("error");
      setMessage("確認用のパスワードが一致しません。");
      return;
    }
    setState("saving");
    const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
    if (error) {
      setState("error");
      setMessage("変更できませんでした。時間をおいて再度お試しください。");
      return;
    }
    setPassword("");
    setConfirm("");
    setState("saved");
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2 style={{ fontSize: 18 }}>パスワードを変更</h2>
      <label htmlFor="new-password">
        新しいパスワード(10 文字以上)
        <input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <label htmlFor="confirm-password">
        新しいパスワード(確認)
        <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      <button type="submit" disabled={state === "saving"}>{state === "saving" ? "変更中…" : "変更する"}</button>
      {state === "saved" && <p>パスワードを変更しました。</p>}
      {state === "error" && <p className="error">{message}</p>}
    </form>
  );
}
