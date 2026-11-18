import { describe, expect, it } from "vitest";
import { CANDIDATES_PER_TURN, TALK_PATTERNS, patternInstructions, patternOrder, pickPatterns } from "@/lib/agents/patterns";
import { decidePacing, pacingInstructions } from "@/lib/agents/pacing";

describe("話し方の型", () => {
  it("8 つあり、id が重ならない", () => {
    expect(TALK_PATTERNS).toHaveLength(8);
    expect(new Set(TALK_PATTERNS.map((p) => p.id)).size).toBe(8);
  });
});

describe("patternOrder: 会話ごとに並びが変わり、同じ会話では変わらない", () => {
  it("同じ会話なら同じ並び", () => {
    expect(patternOrder("conv-a").map((p) => p.id)).toEqual(patternOrder("conv-a").map((p) => p.id));
  });
  it("すべての型を 1 回ずつ含む", () => {
    expect(new Set(patternOrder("conv-a").map((p) => p.id)).size).toBe(8);
  });
  it("会話が違えば、並びはたいてい違う", () => {
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => patternOrder(`conv-${i}`)[0].id));
    expect(firsts.size).toBeGreaterThan(3);
  });
});

describe("pickPatterns", () => {
  it(`毎回 ${CANDIDATES_PER_TURN} つの候補を出す`, () => {
    for (let t = 1; t <= 10; t++) expect(pickPatterns("conv-a", t, "explore")).toHaveLength(CANDIDATES_PER_TURN);
  });
  it("続く 2 回の返事で同じ型を出さない", () => {
    for (let t = 1; t <= 12; t++) {
      const a = pickPatterns("conv-b", t, "explore").map((p) => p.id);
      const b = pickPatterns("conv-b", t + 1, "explore").map((p) => p.id);
      expect(a.filter((id) => b.includes(id))).toEqual([]);
    }
  });
  it("どの段階の組み合わせでも、続く 2 回の返事で同じ型を出さない", () => {
    const stages = ["explore", "soft_close", "firm_close"] as const;
    for (let i = 0; i < 200; i++) {
      const seed = `conv-${i}`;
      for (let t = 1; t <= 12; t++) {
        for (const s1 of stages) {
          for (const s2 of stages) {
            const a = pickPatterns(seed, t, s1).map((p) => p.id);
            const b = pickPatterns(seed, t + 1, s2);
            expect(b.length).toBe(CANDIDATES_PER_TURN);
            expect(b.filter((p) => a.includes(p.id))).toEqual([]);
          }
        }
      }
    }
  });
  it("4 往復で 8 つの型をすべて示す", () => {
    const seen = new Set([1, 2, 3, 4].flatMap((t) => pickPatterns("conv-c", t, "explore").map((p) => p.id)));
    expect(seen.size).toBe(8);
  });
  it("締める段階では、問いかけが主の型を出さない", () => {
    for (let t = 1; t <= 10; t++) expect(pickPatterns("conv-d", t, "firm_close").some((p) => p.asks)).toBe(false);
  });
});

describe("プロンプトへの差し込み", () => {
  it("候補の名前が入り、型の名前を書かないよう指示する", () => {
    const text = patternInstructions(pickPatterns("conv-e", 1, "explore"));
    expect(text).toContain("型の名前は返事に書きません");
  });
  it("seed を渡したときだけ話し方の候補が付く", () => {
    const p = decidePacing({ history: [], userMessage: "集客で悩んでいます" });
    expect(pacingInstructions(p)).not.toContain("今回の返事の話し方");
    expect(pacingInstructions(p, "conv-f")).toContain("今回の返事の話し方");
  });
});
