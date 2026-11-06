import { describe, expect, it } from "vitest";
import { toSpeakable } from "@/lib/voice/elevenlabs";
import { computeSpeechCost } from "@/lib/usage";

describe("toSpeakable", () => {
  it("見出し・箇条書き・リンク・飾り記号を外して、読み上げやすい文にする", () => {
    const md = "## 結論\n\n- **まずは**今日、[動画](https://youtu.be/abc)を見る\n1. 3つ書き出す\n詳しくは https://example.com を見てください";
    expect(toSpeakable(md)).toBe("結論\nまずは今日、動画を見る\n3つ書き出す\n詳しくは を見てください");
  });
});

describe("computeSpeechCost", () => {
  it("文字起こしは秒、読み上げは文字数で概算する", () => {
    expect(computeSpeechCost({ sttSeconds: 3600 })).toBeCloseTo(0.4, 6);
    expect(computeSpeechCost({ ttsChars: 1000 })).toBeCloseTo(0.3, 6);
    expect(computeSpeechCost({})).toBe(0);
  });
});
