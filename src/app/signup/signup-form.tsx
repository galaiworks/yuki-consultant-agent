"use client";

import { useActionState } from "react";
import { signUpWithPass, type SignupState } from "@/app/signup/actions";
import { InsightsConsentFields } from "@/app/components/insights-consent";

/** チケットコードとメールアドレスを入れて登録する(パスワードは決めない) */
export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(signUpWithPass, {});
  return (
    <form className="card login-form" action={action}>
      <label className="login-field" htmlFor="code">
        <span className="field-label"><span lang="en">Code</span> チケットコード</span>
        <input id="code" name="code" required placeholder="NLB-WIN" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
      </label>
      <label className="login-field" htmlFor="name">
        <span className="field-label"><span lang="en">Name</span> お名前(任意)</span>
        <input id="name" name="name" autoComplete="name" maxLength={100} />
      </label>
      <label className="login-field" htmlFor="email">
        <span className="field-label"><span lang="en">Email</span> メールアドレス</span>
        <input id="email" name="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoComplete="email" />
      </label>
      <InsightsConsentFields disabled={pending} />
      <button className="login-submit" type="submit" disabled={pending}>
        {pending ? "登録中…" : "登録してはじめる"}
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
