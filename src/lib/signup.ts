import { z } from "zod";
import { normalizePassCode, PASS_CODE_MIN } from "@/lib/access";
import { PASSWORD_MIN } from "@/lib/signup-rules";

export { PASSWORD_MIN };

/**
 * 特別チケットのコードを持つ人だけが、自分でメールアドレスとパスワードを決めて登録できる。
 * 誰でも登録できる窓口にはしない(有料クライアント限定のため)。
 */

const SignupInput = z
  .object({
    code: z.string().transform((v) => normalizePassCode(v)).pipe(z.string().min(PASS_CODE_MIN)),
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().max(100).optional(),
    password: z.string().min(PASSWORD_MIN).max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"] });

export type SignupValues = { code: string; email: string; name?: string; password: string };

/** 入力を確かめ、だめなら相談者に見せる文を返す(テスト対象) */
export function parseSignup(raw: Record<string, unknown>): { ok: true; value: SignupValues } | { ok: false; error: string } {
  const r = SignupInput.safeParse(raw);
  if (r.success) {
    const { code, email, name, password } = r.data;
    return { ok: true, value: { code, email, name: name || undefined, password } };
  }
  const field = r.error.issues[0]?.path[0];
  if (field === "code") return { ok: false, error: "チケットコードを正しく入力してください。" };
  if (field === "email") return { ok: false, error: "メールアドレスを正しく入力してください。" };
  if (field === "password") return { ok: false, error: `パスワードは ${PASSWORD_MIN} 文字以上にしてください。` };
  if (field === "confirm") return { ok: false, error: "確認用のパスワードが一致しません。" };
  return { ok: false, error: "入力内容を確認してください。" };
}

export type PassRow = {
  revoked_at: string | null;
  expires_at: string | null;
  redemption_count: number;
  max_redemptions: number;
};

/** 登録の前に、チケットがまだ使えるかを確かめる(テスト対象)。使えなければ理由のキーを返す */
export function passProblem(pass: PassRow | null, now: Date): string | null {
  if (!pass) return "pass_not_found";
  if (pass.revoked_at) return "pass_revoked";
  if (pass.expires_at && new Date(pass.expires_at) <= now) return "pass_expired";
  if (pass.redemption_count >= pass.max_redemptions) return "pass_used_up";
  return null;
}

/** 管理者のメールアドレスでは自分で登録させない(メールの持ち主か確かめずに管理者になれてしまうため。テスト対象) */
export function isReservedEmail(email: string, adminEmails: string[]): boolean {
  return adminEmails.includes(email.toLowerCase());
}
