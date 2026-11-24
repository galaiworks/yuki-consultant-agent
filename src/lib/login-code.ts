/** ログイン用のメールのコード。ブラウザとサーバーの両方で使うので、依存なしで置く */

/** Supabase のメールのコードは 6〜10 桁(既定は 6 桁) */
export const LOGIN_CODE_PATTERN = /^\d{6,10}$/;

/** 全角数字・空白・ハイフンを取り除き、半角数字だけにする(テスト対象) */
export function normalizeLoginCode(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-ー－]/g, "");
}

/** コードの送信に失敗したときの案内(テスト対象)。未登録・送りすぎ・それ以外(通信やメールの障害)を分ける */
export function sendErrorMessage(err: { status?: number; code?: string; message?: string }): string {
  if (err.status === 429 || err.code === "over_email_send_rate_limit" || err.code === "over_request_rate_limit") {
    return "続けて送りすぎました。1 分ほど待ってから、もう一度お試しください。";
  }
  // shouldCreateUser: false で未登録のアドレスに送ろうとしたとき
  if (err.code === "otp_disabled" || err.code === "user_not_found" || /signups not allowed/i.test(err.message ?? "")) {
    return "このメールアドレスは登録されていません。登録がまだの方は、下の「新規登録」からお進みください。";
  }
  return "メールを送れませんでした。通信の状態を確かめて、少し待ってからもう一度お試しください。";
}
