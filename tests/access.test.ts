import { describe, expect, it } from "vitest";
import { decideAccess, generatePassCode, hashPassCode, normalizePassCode, type SubscriptionRow } from "@/lib/access";

const plans = [
  { id: "founding", name: "Founding", monthly_usage_limit_usd: 30 },
  { id: "premium", name: "Premium", monthly_usage_limit_usd: 150 },
];
const now = new Date("2026-11-01T00:00:00Z");
const base = { isAdmin: false, plans, defaultPlanId: "founding", usageThisMonthUsd: 0, now, subscriptions: [] as SubscriptionRow[] };
const sub = (o: Partial<SubscriptionRow>): SubscriptionRow => ({
  plan_id: "premium",
  source: "access_pass",
  status: "active",
  current_period_end: "2026-12-01T00:00:00Z",
  ...o,
});

describe("decideAccess", () => {
  it("open モードでは招待済みユーザーが既定プランで使える", () => {
    expect(decideAccess({ ...base, mode: "open" })).toEqual({ allowed: true, planId: "founding", source: "open", limitUsd: 30 });
  });

  it("paid モードでサブスクが無ければ使えない", () => {
    expect(decideAccess({ ...base, mode: "paid" })).toEqual({ allowed: false, reason: "no_subscription" });
  });

  it("paid モードでも特別チケットがあれば使える", () => {
    const r = decideAccess({ ...base, mode: "paid", subscriptions: [sub({})] });
    expect(r).toMatchObject({ allowed: true, planId: "premium", source: "access_pass" });
  });

  it("期限切れ・解約済みのサブスクは数えない", () => {
    const r = decideAccess({
      ...base,
      mode: "paid",
      subscriptions: [sub({ current_period_end: "2026-10-31T23:59:59Z" }), sub({ status: "canceled" })],
    });
    expect(r.allowed).toBe(false);
  });

  it("複数あれば上限の大きいプランを使う", () => {
    const r = decideAccess({ ...base, mode: "paid", subscriptions: [sub({ plan_id: "founding", source: "stripe" }), sub({})] });
    expect(r).toMatchObject({ planId: "premium", limitUsd: 150 });
  });

  it("月間の上限に達したら止める", () => {
    expect(decideAccess({ ...base, mode: "open", usageThisMonthUsd: 30 })).toMatchObject({ allowed: false, reason: "usage_limit_reached" });
  });

  it("管理者は上限なしで使える", () => {
    expect(decideAccess({ ...base, mode: "paid", isAdmin: true, usageThisMonthUsd: 9999 })).toMatchObject({ allowed: true, limitUsd: null });
  });
});

describe("チケットコード", () => {
  it("表記ゆれがあっても同じハッシュになる", () => {
    expect(hashPassCode("abcd-efgh-jkmn-pqrs")).toBe(hashPassCode("ABCD EFGH JKMN PQRS"));
    expect(normalizePassCode(" ab-cd ")).toBe("ABCD");
  });

  it("読み間違えやすい文字を含まない 4 文字区切りのコードを作る", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePassCode();
      expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });
});
