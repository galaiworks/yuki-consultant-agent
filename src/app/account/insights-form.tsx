"use client";

import { useActionState } from "react";
import { updateInsightsConsent, type ConsentState } from "@/app/account/insights-actions";
import { InsightsConsentFields } from "@/app/components/insights-consent";

/** 同意は初期オフ。チェックを外して保存すると集計の元データからも取り消す。 */
export function InsightsConsentForm({ consent }: { consent: boolean }) {
  const [state, action, pending] = useActionState<ConsentState, FormData>(updateInsightsConsent, {});
  return (
    <form className="card" action={action}>
      <h2 style={{ fontSize: 18 }}>相談の傾向の利用（任意）</h2>
      <InsightsConsentFields defaultChecked={consent} disabled={pending} />
      <p className="muted" style={{ fontSize: 12 }}>取り消すにはチェックを外して保存してください。集計の元からも削除し、人数を数え直します。</p>
      <button type="submit" disabled={pending}>{pending ? "保存中…" : "同意の設定を保存"}</button>
      <div aria-live="polite">
        {state.ok && <p>{state.ok}</p>}
        {state.error && <p className="error">{state.error}</p>}
      </div>
    </form>
  );
}
