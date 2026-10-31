import { describe, expect, it } from "vitest";
import { mapStripeStatus } from "@/lib/billing/stripe";
import { loadSkill, stripFrontmatter } from "@/lib/skills";
import { sourceUrl } from "@/lib/knowledge/search";

describe("mapStripeStatus", () => {
  it("Stripe の状態を DB の状態に変換する", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("incomplete_expired")).toBe("expired");
  });
});

describe("skills", () => {
  it("frontmatter を除いた本文を読む", () => {
    expect(stripFrontmatter("---\nname: x\n---\n本文")).toBe("本文");
    for (const s of ["yuki-voice", "yuki-frameworks", "consult-flow"] as const) {
      const body = loadSkill(s);
      expect(body.length).toBeGreaterThan(50);
      expect(body.startsWith("---")).toBe(false);
    }
  });
});

describe("sourceUrl", () => {
  it("YouTube は再生位置付きの URL にする", () => {
    expect(sourceUrl({ url: "https://www.youtube.com/watch?v=abc", kind: "youtube", start_sec: 75, source_id: "s" })).toBe(
      "https://www.youtube.com/watch?v=abc&t=75s",
    );
    expect(sourceUrl({ url: null, kind: "test_sample", start_sec: 0, source_id: "s1" })).toBe("knowledge://s1");
  });
});
