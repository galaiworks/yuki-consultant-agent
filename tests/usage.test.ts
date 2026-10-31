import { describe, expect, it } from "vitest";
import { computeUsage } from "@/lib/usage";

describe("computeUsage", () => {
  it("Opus 5.5 の入出力とキャッシュ読み込みから費用を出す", () => {
    const r = computeUsage("claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 1_000_000,
    });
    // 4 + 2 + 0.2
    expect(r.cost_usd).toBeCloseTo(6.2, 6);
  });

  it("Web 検索の回数も費用に含める", () => {
    const r = computeUsage("claude-sonnet-5-5", { server_tool_use: { web_search_requests: 3 } });
    expect(r.cost_usd).toBeCloseTo(0.03, 6);
    expect(r.web_search_requests).toBe(3);
  });

  it("料金表にないモデルはエラーにする(記録漏れを防ぐ)", () => {
    expect(() => computeUsage("unknown-model", {})).toThrow();
  });
});
