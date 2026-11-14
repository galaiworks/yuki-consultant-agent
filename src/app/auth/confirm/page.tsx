import { ConfirmClient } from "./confirm-client";

/** メールのログインリンクから戻ってくる画面(ログインの処理はブラウザ側で行う) */
export default function ConfirmPage() {
  return (
    <main className="shell" style={{ maxWidth: 480 }}>
      <h1>YUKI Consultant Agent</h1>
      <ConfirmClient />
    </main>
  );
}
