import { describe, expect, it } from "vitest";
import { gradeDeterministic, parseCases } from "@/lib/evals/cases";

describe("parseCases", () => {
  it("正しい行だけ読み、壊れた行は行番号を返す", () => {
    const ok = JSON.stringify({ id: "a", prompt: "相談", graders: [{ name: "cites", type: "cites" }] });
    const r = parseCases(`${ok}\n{壊れた\n${JSON.stringify({ id: "b", prompt: "x", graders: [] })}`);
    expect(r.cases.map((c) => c.id)).toEqual(["a"]);
    expect(r.errors).toEqual([expect.stringContaining("2 行目"), expect.stringContaining("3 行目")]);
  });
});

describe("regex の検証", () => {
  it("壊れた正規表現のケースは読み込み時に弾く", () => {
    const bad = JSON.stringify({ id: "x", prompt: "相談", graders: [{ name: "r", type: "regex", pattern: "[" }] });
    expect(parseCases(bad).errors).toHaveLength(1);
  });
});

describe("gradeDeterministic", () => {
  const run = { text: "必ず儲かります", citations: 0, searched: true };
  it("使ってはいけない表現が含まれていれば不合格", () => {
    expect(gradeDeterministic({ name: "n", type: "regex", pattern: "必ず儲かり", match: "not_contains" }, run).passed).toBe(false);
    expect(gradeDeterministic({ name: "n", type: "regex", pattern: "必ず儲かり", match: "contains" }, run).passed).toBe(true);
  });
  it("出典と検索の有無を見る", () => {
    expect(gradeDeterministic({ name: "c", type: "cites" }, run).passed).toBe(false);
    expect(gradeDeterministic({ name: "s", type: "searched" }, run).passed).toBe(true);
  });
});
