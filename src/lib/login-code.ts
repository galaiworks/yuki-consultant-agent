/** ログイン用のメールのコード。ブラウザとサーバーの両方で使うので、依存なしで置く */

/** Supabase のメールのコードは 6〜10 桁(既定は 6 桁) */
export const LOGIN_CODE_PATTERN = /^\d{6,10}$/;

/** 全角数字・空白・ハイフンを取り除き、半角数字だけにする(テスト対象) */
export function normalizeLoginCode(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-ー－]/g, "");
}
