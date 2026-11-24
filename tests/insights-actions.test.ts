import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/insights/route";
import { GET } from "@/app/api/admin/insights/export/route";
import { updateInsightsConsent } from "@/app/account/insights-actions";
import { reviewInsightAction } from "@/app/admin/insights-actions";
import { SAMPLE_PATTERNS } from "./fixtures/insights";

const mocks = vi.hoisted(() => ({
  adminAllowed: true, loggedIn: true, consentError: false, savedConsent: false,
  createAdmin: vi.fn(), run: vi.fn(), list: vi.fn(), update: vi.fn(), eq: vi.fn(), review: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/guard", () => ({
  currentUserIsAdmin: async () => ({ user: mocks.loggedIn ? { id: "operator" } : null, isAdmin: mocks.adminAllowed }),
  requireAdmin: async () => {
    if (!mocks.loggedIn || !mocks.adminAllowed) throw new Error("unauthorized");
    return { user: { id: "operator" }, admin: { rpc: mocks.review } };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createAdmin }));
vi.mock("@/lib/insights/extract", () => ({ runInsightExtraction: mocks.run }));
vi.mock("@/lib/insights/topics", () => ({ listInsightTopics: mocks.list }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.loggedIn ? { id: "self" } : null }, error: null }) },
  from: () => {
    const query = {
      update(value: { insights_consent: boolean }) { mocks.update(value); mocks.savedConsent = value.insights_consent; return query; },
      eq(...args: unknown[]) { mocks.eq(...args); return query; }, select() { return query; },
      single: async () => ({ data: { insights_consent: mocks.savedConsent }, error: mocks.consentError ? {} : null }),
    };
    return query;
  },
}) }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, { adminAllowed: true, loggedIn: true, consentError: false, savedConsent: false });
  mocks.createAdmin.mockReturnValue({ type: "service-role" });
  mocks.run.mockResolvedValue({ processed: 1, skipped: 0, stopped: "complete" });
  mocks.review.mockResolvedValue({ data: true, error: null });
  mocks.list.mockResolvedValue([]);
});

describe("管理者の境界", () => {
  it.each(["anonymous", "student"])("%s は実行も書き出しも拒否し、service role を作らない", async (role) => {
    mocks.loggedIn = role !== "anonymous"; mocks.adminAllowed = false;
    expect((await POST()).status).toBe(403);
    expect((await GET()).status).toBe(403);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("運営のIDで実行し、下書きや少人数は書き出さず、キャッシュしない", async () => {
    expect((await POST()).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledWith({ type: "service-role" }, "operator");
    mocks.list.mockResolvedValue(["approved", "draft", "rejected"].map((status, i) => ({ ...SAMPLE_PATTERNS[0], id: `private-${i}`, user_count: 5, status, video_gap: true })));
    const output = await GET();
    const body = await output.text();
    expect(mocks.list).toHaveBeenCalledWith({ type: "service-role" }, true);
    expect(body.match(/## /g)).toHaveLength(1);
    expect(body).not.toContain("private-");
    expect(output.headers.get("cache-control")).toContain("no-store");
  });
  it("承認は運営の ID で RPC に渡し、人数不足での拒否を成功扱いしない", async () => {
    const form = new FormData(); form.set("id", "00000000-0000-4000-8000-000000000001"); form.set("status", "approved"); form.set("reviewerId", "forged");
    expect(await reviewInsightAction({}, form)).toHaveProperty("ok");
    expect(mocks.review).toHaveBeenCalledWith("review_insight_topic", expect.objectContaining({ p_reviewer_id: "operator" }));
    mocks.review.mockResolvedValueOnce({ data: false, error: null });
    expect(await reviewInsightAction({}, form)).toHaveProperty("error");
  });
});

describe("本人だけが同意を変更する", () => {
  it("チェックなしは取り消しであり、送信された他人の ID や日時は使わない", async () => {
    const form = new FormData(); form.set("userId", "other"); form.set("insights_consent_at", "forged");
    expect(await updateInsightsConsent({}, form)).toHaveProperty("ok");
    expect(mocks.update).toHaveBeenCalledWith({ insights_consent: false });
    expect(mocks.eq).toHaveBeenCalledWith("id", "self");
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });
  it("明示的なチェックだけを同意とし、DBの失敗は成功扱いしない", async () => {
    const form = new FormData(); form.set("insightsConsent", "on");
    expect(await updateInsightsConsent({}, form)).toHaveProperty("ok");
    expect(mocks.update).toHaveBeenCalledWith({ insights_consent: true });
    mocks.consentError = true;
    expect(await updateInsightsConsent({}, form)).toHaveProperty("error");
  });
  it("未ログインなら設定を書かない", async () => {
    mocks.loggedIn = false;
    expect(await updateInsightsConsent({}, new FormData())).toHaveProperty("error");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
