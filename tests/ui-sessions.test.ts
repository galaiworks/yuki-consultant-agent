import { describe, expect, it } from "vitest";
import { conversationLabel, conversationPage, isNearLogBottom, mergeConversations, nextThinkingLine, type Conversation } from "@/lib/ui/sessions";

const row = (id: string, updated_at = "2026-11-19T00:00:00Z"): Conversation => ({ id, title: id, updated_at });

describe("会話一覧", () => {
  it("更新の新しい順にし、同時刻でもページをまたぐ順序を固定する", () => {
    const input = [row("a"), row("c"), row("b", "2026-11-20T00:00:00Z")];
    expect(mergeConversations(input).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(input.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
  it("会話を更新したら先頭へ移し、ページの重複は除く", () => {
    const result = mergeConversations([row("a"), row("b")], [row("a", "2026-11-20T00:00:00Z")]);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result[0].updated_at).toBe("2026-11-20T00:00:00Z");
  });
  it("50 件ごとに区切り、51 件目があるときだけ続きを表示する", () => {
    const rows = Array.from({ length: 51 }, (_, i) => row(String(i).padStart(3, "0")));
    expect(conversationPage(rows)).toMatchObject({ hasMore: true });
    expect(conversationPage(rows).items).toHaveLength(50);
    expect(conversationPage(rows.slice(0, 50)).hasMore).toBe(false);
    expect(conversationPage([])).toEqual({ items: [], hasMore: false });
  });
  it("声の目印を題名と分け、文字の会話や題名なしも表示する", () => {
    expect(conversationLabel("(声)売上の相談")).toEqual({ voice: true, title: "売上の相談" });
    expect(conversationLabel("採用の相談")).toEqual({ voice: false, title: "採用の相談" });
    expect(conversationLabel(null)).toEqual({ voice: false, title: "相談" });
  });
});

describe("待機表示とスクロール", () => {
  it("待機の一言は空にならず、直前と同じものを繰り返さない", () => {
    let previous = "";
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const next = nextThinkingLine(previous);
      expect(next).toBeTruthy();
      expect(next).not.toBe(previous);
      seen.add(next);
      previous = next;
    }
    expect(seen.size).toBe(4);
  });
  it("読み返し中は追従せず、下端 80px 以内なら追従する", () => {
    expect(isNearLogBottom(100, 3000, 600)).toBe(false);
    expect(isNearLogBottom(2320, 3000, 600)).toBe(true);
    expect(isNearLogBottom(2319, 3000, 600)).toBe(false);
    expect(isNearLogBottom(0, 200, 600)).toBe(true);
  });
});
