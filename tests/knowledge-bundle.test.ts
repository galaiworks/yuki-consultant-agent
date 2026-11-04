import { describe, expect, it } from "vitest";
import { buildChunkRows, EVIDENCE_INDEX_OFFSET, parseBundle } from "@/lib/knowledge/bundle";
import { personaText, type Persona } from "@/lib/persona";

const video = {
  type: "video",
  video_id: "abcdefghijk",
  title: "テスト動画",
  url: "https://youtu.be/abcdefghijk",
  published_at: "2024-12-16",
  chunks: ["一つ目の文章です", "二つ目の文章です"],
  evidence: [{ category: "values", claim: "要約です", quote: "原文です" }],
};

describe("parseBundle", () => {
  it("persona と video を分けて読み、壊れた行は行番号付きで返す", () => {
    const text = [
      JSON.stringify({ type: "persona", key: "voice", body: "トンマナの本文です。".repeat(5), version: "v1.2" }),
      JSON.stringify(video),
      "{壊れた行",
      JSON.stringify({ ...video, video_id: "短い" }),
      "",
    ].join("\n");
    const r = parseBundle(text);
    expect(r.persona).toHaveLength(1);
    expect(r.videos).toHaveLength(1);
    expect(r.errors).toEqual([expect.stringContaining("3 行目"), expect.stringContaining("4 行目")]);
  });
});

describe("buildChunkRows", () => {
  it("逐語録は 0 から、引用は 10000 から番号を振り、要約と原文を分けて書く", () => {
    const { videos } = parseBundle(JSON.stringify(video));
    const rows = buildChunkRows(videos[0]);
    expect(rows.map((r) => r.chunk_index)).toEqual([0, 1, EVIDENCE_INDEX_OFFSET]);
    expect(rows[2].content).toContain("要点(AI による要約): 要約です");
    expect(rows[2].content).toContain("原文:「原文です」");
  });
});

describe("personaText", () => {
  it("指定した層だけを見出し付きでつなぎ、無い層は飛ばす", () => {
    const p: Persona = { source: "database", version: "v1.2", layers: { values: "価値観の本文", voice: "話し方の本文" } };
    const t = personaText(p, ["values", "reasoning", "voice"]);
    expect(t).toContain("価値観の本文");
    expect(t).toContain("話し方の本文");
    expect(t).not.toContain("結論の出し方");
  });
  it("仮版で動いているときは注意書きを付ける", () => {
    const p: Persona = { source: "provisional", version: null, layers: { voice: "仮の話し方" } };
    expect(personaText(p, ["voice"])).toContain("仮版");
  });
});
