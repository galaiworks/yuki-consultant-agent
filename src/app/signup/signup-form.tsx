"use client";

import { useActionState } from "react";
import { signUpWithPass, type SignupState } from "@/app/signup/actions";
import { PASSWORD_MIN } from "@/lib/signup-rules";

/** チケットコード・メールアドレス・パスワードを入れて登録する */
export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUpWithPass, {});
  return (
    <form className="card login-form" action={action}>
      <label className="login-field" htmlFor="code">
        <span className="field-label"><span lang="en">Code</span> チケットコード</span>
        <input id="code" name="code" required placeholder="ABCD-EFGH-JKLM-NPQR" autoComplete="off" />
      </label>
      <label className="login-field" htmlFor="name">
        <span className="field-label"><span lang="en">Name</span> お名前(任意)</span>
        <input id="name" name="name" autoComplete="name" maxLength={100} />
      </label>
      <label className="login-field" htmlFor="email">
        <span className="field-label"><span lang="en">Email</span> メールアドレス</span>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </label>
      <label className="login-field" htmlFor="password">
        <span className="field-label"><span lang="en">Password</span> パスワード({PASSWORD_MIN} 文字以上)</span>
        <input id="password" name="password" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" />
      </label>
      <label className="login-field" htmlFor="confirm">
        <span className="field-label"><span lang="en">Confirm</span> パスワード(確認)</span>
        <input id="confirm" name="confirm" type="password" required minLength={PASSWORD_MIN} autoComplete="new-password" />
      </label>
      <button className="login-submit" type="submit" disabled={pending}>
        {pending ? "登録中…" : "登録してはじめる"}
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
