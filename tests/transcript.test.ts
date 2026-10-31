import { describe, expect, it } from "vitest";
import { chunkCues, chunkText, parseSubtitles } from "@/lib/knowledge/transcript";

const SRT = `1
00:00:01,000 --> 00:00:04,500
米国では最初に

2
00:01:02,000 --> 00:01:05,000
<i>顧客の問題</i>を聞かれます
`;

const VTT = `WEBVTT

00:10.000 --> 00:12.000
短い字幕
`;

describe("parseSubtitles", () => {
  it("SRT の開始秒と本文を読み、タグを消す", () => {
    expect(parseSubtitles(SRT)).toEqual([
      { startSec: 1, endSec: 4, text: "米国では最初に" },
      { startSec: 62, endSec: 65, text: "顧客の問題を聞かれます" },
    ]);
  });

  it("WebVTT の分:秒 形式も読める", () => {
    expect(parseSubtitles(VTT)).toEqual([{ startSec: 10, endSec: 12, text: "短い字幕" }]);
  });
});

describe("chunk", () => {
  it("字幕は上限文字数でまとめ、先頭の開始秒を残す", () => {
    const cues = Array.from({ length: 10 }, (_, i) => ({ startSec: i * 10, endSec: i * 10 + 9, text: "あ".repeat(100) }));
    const chunks = chunkCues(cues, 250);
    expect(chunks).toHaveLength(5);
    expect(chunks[1]).toMatchObject({ index: 1, startSec: 20, endSec: 39 });
  });

  it("テキストは段落単位でまとめる", () => {
    const chunks = chunkText("段落1\n\n段落2\n\n" + "長".repeat(600), 100);
    expect(chunks.map((c) => c.index)).toEqual([0, 1]);
    expect(chunks[0].content).toBe("段落1\n段落2");
  });
});
