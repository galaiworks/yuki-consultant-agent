import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runInsightExtraction } from "@/lib/insights/extract";
import { SAMPLE_PATTERNS as INSIGHT_PATTERNS } from "./fixtures/insights";
import { MODELS } from "@/lib/config";

const mocks = vi.hoisted(() => ({ create: vi.fn(), usage: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/agents/client", () => ({ anthropic: () => ({ beta: { messages: { create: mocks.create } } }), textOf: (blocks: { text: string }[]) => blocks.map((b) => b.text).join("") }));
vi.mock("@/lib/usage", () => ({ recordUsage: mocks.usage }));
vi.mock("@/lib/knowledge/search", () => ({ searchKnowledge: mocks.search }));

const claim = { conversation_id: "conv", user_id: "student", claim_token: "token", consent_at: "consent-time", claimed_updated_at: "conversation-time" };

/** RPC の権限と原子的処理は別の PostgreSQL テストで確認し、ここではサーバーの分岐を検証する。 */
function database(options: { claims?: typeof claim[]; input?: string; saved?: boolean; saveError?: boolean } = {}) {
  const rpc = vi.fn((name: string, _args: unknown) => ({
    abortSignal: async () => {
      if (name === "claim_insight_conversations") return { data: options.claims ?? [claim], error: null };
      if (name === "read_insight_conversation") return { data: [{ text: options.input ?? "無料セミナーから本講座への申し込みが伸びません。山田さんの test@example.com" }], error: null };
      if (name === "save_insight_extraction") return { data: options.saved ?? true, error: options.saveError ? { message: "private failure" } : null };
      return { data: null, error: null };
    },
  }));
  const query = { select() { return query; }, order() { return query; }, limit() { return query; }, abortSignal: async () => ({ data: [], error: null }) };
  return { admin: { rpc, from: () => query } as unknown as SupabaseClient, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReset();
  mocks.create.mockImplementation(async (input: { system: string }) => ({ stop_reason: "end_turn", content: [{ text: input.system.startsWith("匿名化監査") ? '{"safe":true}' : JSON.stringify(INSIGHT_PATTERNS[0]) }], usage: { input_tokens: 100, output_tokens: 50 } }));
  mocks.search.mockReset(); mocks.search.mockResolvedValue([]);
});

describe("同意つき傾向の抽出", () => {
  it("対象会話がない場合は AI を使わない（非同意者の除外は DB による）", async () => {
    const db = database({ claims: [] });
    expect(await runInsightExtraction(db.admin, "operator")).toEqual({ processed: 0, skipped: 0, stopped: "complete" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it("入力も消し込み、定型の匿名情報だけを保存し、運営に費用を計上する", async () => {
    const db = database();
    expect(await runInsightExtraction(db.admin, "operator")).toMatchObject({ processed: 1, stopped: "complete" });
    const request = mocks.create.mock.calls[0][0];
    expect(request.model).toBe(MODELS.worker);
    expect(request.messages[0].content).not.toMatch(/山田|test@example.com/);
    expect(mocks.usage).toHaveBeenCalledWith(db.admin, { userId: "operator" }, "insights:extract", MODELS.worker, { input_tokens: 100, output_tokens: 50 }, expect.objectContaining({ required: true }));
    expect(db.rpc).toHaveBeenCalledWith("save_insight_extraction", { p_conversation_id: "conv", p_claim_token: "token", p_theme: INSIGHT_PATTERNS[0].theme, p_pattern: INSIGHT_PATTERNS[0].pattern, p_category: "集客", p_video_gap: true });
  });
  it("消し込みが必要な個人情報の断片は破棄し、課金記録を残して停止する", async () => {
    const db = database();
    mocks.create.mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ text: JSON.stringify({ ...INSIGHT_PATTERNS[0], theme: "株式会社秘密商事の悩み" }) }], usage: {} });
    expect(await runInsightExtraction(db.admin, "operator")).toMatchObject({ stopped: "failed" });
    expect(mocks.usage).toHaveBeenCalledTimes(1);
    expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain("save_insight_extraction");
    expect(db.rpc).toHaveBeenCalledWith("release_insight_conversation", { p_conversation_id: "conv", p_claim_token: "token" });
  });
  it("プログラムで検出しきれない識別情報も、独立した匿名化判定が拒否したら保存しない", async () => {
    const db = database();
    mocks.create.mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ text: JSON.stringify({ ...INSIGHT_PATTERNS[0], theme: "秘密商事の商品開発に迷う" }) }], usage: {} })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ text: '{"safe":false}' }], usage: {} });
    expect(await runInsightExtraction(db.admin, "operator")).toMatchObject({ stopped: "failed" });
    expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain("save_insight_extraction");
    expect(mocks.usage).toHaveBeenCalledTimes(2);
  });
  it("拒否や出力上限でも利用料を記録し、結果を採用しない", async () => {
    const db = database();
    mocks.create.mockResolvedValueOnce({ stop_reason: "refusal", content: [], usage: {} });
    expect(await runInsightExtraction(db.admin, "operator")).toMatchObject({ stopped: "failed" });
    expect(mocks.usage).toHaveBeenCalledTimes(1);
  });
  it("同意取り消し等で保存を拒否された結果は保存件数に含めない", async () => {
    const db = database({ saved: false });
    expect(await runInsightExtraction(db.admin, "operator")).toMatchObject({ processed: 0, skipped: 1 });
  });
  it("該当しない会話は null として処理済みにし、動画検索をしない", async () => {
    const db = database();
    mocks.create.mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ text: "null" }], usage: {} });
    expect(await runInsightExtraction(db.admin, "operator")).toMatchObject({ processed: 0, skipped: 1 });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("save_insight_extraction", expect.objectContaining({ p_theme: null }));
  });
  it("動画の答えがあるときだけ未回答フラグを外し、判定の費用も運営に記録する", async () => {
    const db = database();
    mocks.search.mockResolvedValueOnce([{ kind: "youtube", is_test: false, content: "募集の案内を見直す" }]);
    mocks.create.mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ text: JSON.stringify(INSIGHT_PATTERNS[0]) }], usage: {} })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ text: '{"safe":true}' }], usage: {} })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ text: '{"answered":true}' }], usage: {} });
    expect(await runInsightExtraction(db.admin, "operator")).toMatchObject({ processed: 1 });
    expect(db.rpc).toHaveBeenCalledWith("save_insight_extraction", expect.objectContaining({ p_video_gap: false }));
    expect(mocks.usage).toHaveBeenCalledWith(db.admin, { userId: "operator" }, "insights:video_coverage", MODELS.worker, {}, expect.objectContaining({ required: true }));
  });
  it("テスト用動画と文書は動画の答えに数えない", async () => {
    const db = database();
    mocks.search.mockResolvedValueOnce([{ kind: "youtube", is_test: true }, { kind: "document", is_test: false }]);
    await runInsightExtraction(db.admin, "operator");
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenCalledWith("save_insight_extraction", expect.objectContaining({ p_video_gap: true }));
  });
  it("保存失敗時はその先の会話を処理せず、残りのリースを解放する", async () => {
    const db = database({ claims: [claim, { ...claim, conversation_id: "next" }], saveError: true });
    expect(await runInsightExtraction(db.admin, "operator")).toMatchObject({ stopped: "failed" });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenCalledWith("release_insight_conversation", expect.objectContaining({ p_conversation_id: "next" }));
  });
});
