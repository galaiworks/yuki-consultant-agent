import { describe, expect, it } from "vitest";
import { toSpeakable } from "@/lib/voice/elevenlabs";
import { computeSpeechCost } from "@/lib/usage";
import { SentenceSplitter } from "@/lib/voice/sentences";

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

describe("SentenceSplitter", () => {
  it("言い終わった文から順に取り出し、残りは最後にまとめて返す", () => {
    const s = new SentenceSplitter();
    expect(s.push("サミットの集客、すごく大事")).toEqual([]);
    expect(s.push("なタイミングですよね。結論から")).toEqual(["サミットの集客、すごく大事なタイミングですよね。"]);
    expect(s.push("言うと、一人に絞ることです！？次")).toEqual(["結論から言うと、一人に絞ることです！？"]);
    expect(s.flush()).toBe("次");
    expect(s.flush()).toBeNull();
  });

  it("短すぎる文は次の文とまとめる", () => {
    const s = new SentenceSplitter();
    expect(s.push("はい。それはすごく良い質問ですね。")).toEqual(["はい。それはすごく良い質問ですね。"]);
  });
});
