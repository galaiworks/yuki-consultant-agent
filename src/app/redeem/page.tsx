import { RedeemForm } from "@/app/redeem/redeem-form";
import { Nav } from "@/app/nav";

export default function RedeemPage() {
  return (
    <main className="shell" style={{ maxWidth: 560 }}>
      <Nav />
      <h1>特別チケットを使う</h1>
      <p className="muted">ご利用には有効なプランか特別チケットが必要です。担当者から受け取ったコードを入力してください。</p>
      <RedeemForm />
    </main>
  );
}
