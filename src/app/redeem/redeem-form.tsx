"use client";

import { useActionState } from "react";
import { redeemPass, type RedeemState } from "@/app/redeem/actions";

export function RedeemForm() {
  const [state, action, pending] = useActionState<RedeemState, FormData>(redeemPass, {});
  return (
    <form className="card" action={action}>
      <label htmlFor="code">
        チケットコード
        <input id="code" name="code" required placeholder="ABCD-EFGH-JKLM-NPQR" autoComplete="off" />
      </label>
      <button type="submit" disabled={pending}>{pending ? "確認中…" : "チケットを使う"}</button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
