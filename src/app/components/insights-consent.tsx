import Link from "next/link";
import { INSIGHTS_CONSENT_TEXT } from "@/lib/insights/privacy";

/** 登録時とアカウント画面で同じ任意同意と用途を案内する。 */
export function InsightsConsentFields({ defaultChecked = false, disabled = false }: { defaultChecked?: boolean; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="consent-check">
        <input type="checkbox" name="insightsConsent" defaultChecked={defaultChecked} disabled={disabled} aria-describedby="insights-consent-description" />
        <span>{INSIGHTS_CONSENT_TEXT}</span>
      </label>
      <p id="insights-consent-description" className="muted" style={{ fontSize: 12 }}>
        講座・動画・サービスの改善に使います。別の利用者への回答には使いません。<br />
        名前・会社名・連絡先や具体的な金額・人数は傾向に残さず、同じテーマが異なる利用者から5人以上集まったものだけを運営が確認して使います。<br />
        同意しなくてもサービスを利用できます。<Link href="/privacy">プライバシーポリシー</Link>
      </p>
    </div>
  );
}
