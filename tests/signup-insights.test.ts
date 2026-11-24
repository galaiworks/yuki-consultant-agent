import { beforeEach, describe, expect, it, vi } from "vitest";
import { signUpWithPass } from "@/app/signup/actions";

const state = vi.hoisted(() => ({
  profileUpdate: vi.fn(), createUser: vi.fn(), verifyOtp: vi.fn(), deleteUser: vi.fn(), generateLink: vi.fn(), signOut: vi.fn(),
  consentError: false, createError: null as null | { message: string }, linkError: false, noHash: false, otpError: false, rpcError: false,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({
  from: () => {
    const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: { revoked_at: null, expires_at: null, redemption_count: 0, max_redemptions: 1 }, error: null }) };
    return query;
  },
  auth: { admin: {
    createUser: async (attrs: unknown) => {
      state.createUser(attrs);
      return state.createError ? { data: { user: null }, error: state.createError } : { data: { user: { id: "new-student" } }, error: null };
    },
    generateLink: async () => {
      state.generateLink();
      if (state.linkError) return { data: null, error: { message: "boom" } };
      return { data: { properties: { hashed_token: state.noHash ? undefined : "hashed-token" } }, error: null };
    },
    deleteUser: async (id: string) => { state.deleteUser(id); return { error: null }; },
    updateUserById: async () => ({ error: null }),
  } },
}) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  auth: {
    verifyOtp: async (args: unknown) => { state.verifyOtp(args); return { error: state.otpError ? { message: "invalid" } : null }; },
    refreshSession: async () => ({ error: null }),
    signOut: async () => { state.signOut(); return { error: null }; },
  },
  rpc: async () => ({ error: state.rpcError ? { message: "pass_used_up" } : null }),
  from: () => {
    const query = {
      update(value: unknown) { state.profileUpdate(value); return query; }, eq() { return query; }, select() { return query; },
      single: async () => ({ data: { insights_consent: !state.consentError }, error: state.consentError ? {} : null }),
    };
    return query;
  },
}) }));

/** 外部の登録 API は使わず、同意の初期値と登録後の本人更新を確認する。 */
function signupForm(consent = false) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ code: "ABCDEF", email: "student@example.com" })) form.set(key, value);
  if (consent) form.set("insightsConsent", "on");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { consentError: false, createError: null, linkError: false, noHash: false, otpError: false, rpcError: false });
});
describe("登録時の任意同意", () => {
  it("チェックしない登録では同意を更新しない", async () => {
    await expect(signUpWithPass({}, signupForm())).rejects.toThrow("redirect:/chat");
    expect(state.profileUpdate).not.toHaveBeenCalled();
  });
  it("チェックした場合だけ、登録後に本人のセッションで同意を保存する", async () => {
    await expect(signUpWithPass({}, signupForm(true))).rejects.toThrow("redirect:/chat");
    expect(state.profileUpdate).toHaveBeenCalledWith({ insights_consent: true });
  });
  it("同意保存の失敗は登録自体の取消や成功にせず、設定が未完了と知らせる", async () => {
    state.consentError = true;
    expect(await signUpWithPass({}, signupForm(true))).toHaveProperty("error", expect.stringContaining("同意設定を保存できません"));
  });
});

describe("パスワードなしの登録", () => {
  it("パスワードを付けずに利用者を作り、メールを送らないワンタイムの合い言葉でその場でログインする", async () => {
    await expect(signUpWithPass({}, signupForm())).rejects.toThrow("redirect:/chat");
    expect(state.createUser).toHaveBeenCalledWith(expect.not.objectContaining({ password: expect.anything() }));
    expect(state.verifyOtp).toHaveBeenCalledWith({ token_hash: "hashed-token", type: "email" });
  });
});

describe("パスワードなしの登録: 失敗したら元に戻す", () => {
  it("すでに登録済みなら、合い言葉を作らずに案内する", async () => {
    state.createError = { message: "User already registered" };
    expect(await signUpWithPass({}, signupForm())).toHaveProperty("error", expect.stringContaining("すでに登録"));
    expect(state.generateLink).not.toHaveBeenCalled();
  });
  it.each([
    ["合い言葉を作れない", () => { state.linkError = true; }],
    ["合い言葉が空", () => { state.noHash = true; }],
    ["その場のログインに失敗", () => { state.otpError = true; }],
  ])("%s → 作った利用者を消してチケットを使わない", async (_label, setup) => {
    setup();
    expect(await signUpWithPass({}, signupForm())).toHaveProperty("error");
    expect(state.deleteUser).toHaveBeenCalledWith("new-student");
  });
  it("チケットの引き換えに失敗 → ログアウトして利用者を消す", async () => {
    state.rpcError = true;
    expect(await signUpWithPass({}, signupForm())).toHaveProperty("error");
    expect(state.signOut).toHaveBeenCalled();
    expect(state.deleteUser).toHaveBeenCalledWith("new-student");
  });
  it("引き換えが済んだあとの失敗では、利用者を消さない", async () => {
    state.consentError = true;
    await signUpWithPass({}, signupForm(true));
    expect(state.deleteUser).not.toHaveBeenCalled();
  });
});
