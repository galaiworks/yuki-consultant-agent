import { describe, expect, it } from "vitest";
import { countInsightUsers, exportInsightMarkdown, parseInsightExtraction, redactInsightText, visibleInsightTopics, type InsightTopic } from "@/lib/insights/privacy";
import { SAMPLE_PATTERNS as INSIGHT_PATTERNS } from "./fixtures/insights";

const topic = (id: string, users: number, status: InsightTopic["status"] = "draft"): InsightTopic => ({
  ...INSIGHT_PATTERNS[0], id, user_count: users, status, video_gap: true, updated_at: "2026-11-19T00:00:00Z",
});

describe("傾向の匿名化", () => {
  it.each([
    ["メール test.person@example.com です", "test.person@example.com"],
    ["連絡先は 090-1234-5678", "090-1234-5678"],
    ["電話 +1 (310) 555-1234", "+1 (310) 555-1234"],
    ["https://example.com/p?user=name", "example.com"],
    ["www.example.com/contact", "example.com"],
    ["売上１００万円、参加者２５人、予算$5,000", "100万円"],
    ["売上三百万円、参加者五名", "三百万円"],
    ["山田さんと佐藤様と田中先生", "山田"],
    ["株式会社秘密商事です", "秘密商事"],
    ["東京都渋谷区秘密町1-2-3", "渋谷区"],
  ])("AI 入力からも識別子を消す: %s", (text, identifier) => {
    expect(redactInsightText(text)).not.toContain(identifier);
  });
  it("個人情報を消した断片・追加フィールド・会社名は保存対象にしない", () => {
    expect(() => parseInsightExtraction(JSON.stringify({ ...INSIGHT_PATTERNS[0], theme: "株式会社秘密商事の集客" }))).toThrow();
    expect(() => parseInsightExtraction(JSON.stringify({ ...INSIGHT_PATTERNS[0], email: "a@example.com" }))).toThrow();
    expect(() => parseInsightExtraction(JSON.stringify({ ...INSIGHT_PATTERNS[0], pattern: "山田さんが100万円で募集" }))).toThrow();
    expect(() => parseInsightExtraction("not JSON")).toThrow();
  });
  it("新しい一般的なテーマ・型・カテゴリを採用できる", () => {
    expect(parseInsightExtraction(JSON.stringify(INSIGHT_PATTERNS[0]))).toEqual(INSIGHT_PATTERNS[0]);
    expect(parseInsightExtraction("null")).toBeNull();
  });
  it("短いテーマや全角の括弧も採用し、説明は三文までにする", () => {
    expect(parseInsightExtraction(JSON.stringify({ theme: "価格設定", pattern: "価値（提供内容）に合う価格に迷う。", category: "商品" })))
      .toMatchObject({ theme: "価格設定", pattern: "価値(提供内容)に合う価格に迷う。" });
    expect(() => parseInsightExtraction(JSON.stringify({ theme: "価格設定", pattern: "迷う。悩む。考える。試す。", category: "商品" }))).toThrow();
  });
});

describe("人数の境界と書き出し", () => {
  it("同じ人の複数会話を人数に足さず、取り消した人の全会話を除く", () => {
    const sources = ["a", "b", "a", "c", "d", "e"].map((user_id) => ({ user_id }));
    expect(countInsightUsers(sources)).toBe(5);
    expect(countInsightUsers(sources, "a")).toBe(4);
    expect(visibleInsightTopics([topic("x", countInsightUsers(sources, "a"), "approved")])).toEqual([]);
  });
  it("4 人以下を隠し、5 人以上を人数順に表示する", () => {
    expect(visibleInsightTopics([topic("small", 4), topic("five", 5), topic("many", 8)]).map((t) => t.id)).toEqual(["many", "five"]);
  });
  it("承認済みかつ5人以上の匿名傾向だけを書き出し、内部 ID や下書きは含めない", () => {
    const data = [topic("secret-user-id", 5, "approved"), { ...topic("draft", 9), theme: INSIGHT_PATTERNS[1].theme }, topic("small", 4, "approved"),
      { ...topic("tampered", 8, "approved"), pattern: "漏れてはいけない株式会社秘密商事の相談" }];
    const md = exportInsightMarkdown(data);
    expect(md).toContain(INSIGHT_PATTERNS[0].theme);
    expect(md).toContain("5 人");
    expect(md).not.toMatch(/secret-user-id|漏れてはいけない|small|9 人|4 人/);
    expect(visibleInsightTopics(data, true)).toHaveLength(1);
  });
  it("プロフィールにある敬称なしの名前・会社名も消す", () => {
    expect(redactInsightText("山田太郎と秘密商事の相談", ["山田太郎", "秘密商事"])).not.toMatch(/山田太郎|秘密商事/);
  });
});
