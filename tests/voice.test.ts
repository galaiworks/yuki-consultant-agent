import { describe, expect, it } from "vitest";
import { toSpeakable } from "@/lib/voice/elevenlabs";
import { computeSpeechCost } from "@/lib/usage";
import { SentenceSplitter, splitForSpeech } from "@/lib/voice/sentences";
import { breakLongParagraphs } from "@/lib/text/wrap";

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

describe("splitForSpeech", () => {
  it("読点は短い間、句点は長い間として区切る。閉じかっこは前に含める", () => {
    expect(splitForSpeech("結論から言うと、一人に絞ることです。「まずは一人」と決めましょう！次")).toEqual([
      { text: "結論から言うと、", pause: "comma" },
      { text: "一人に絞ることです。", pause: "period" },
      { text: "「まずは一人」と決めましょう！", pause: "period" },
      { text: "次", pause: "none" },
    ]);
  });

  it("短い読点区切りは次とまとめ、数字の半角カンマでは切らない", () => {
    expect(splitForSpeech("はい、売上は1,000万円を目指しましょう。")).toEqual([
      { text: "はい、売上は1,000万円を目指しましょう。", pause: "period" },
    ]);
  });

  it("「。」」のように句点と閉じかっこが続いても 1 つの区切りにする", () => {
    expect(splitForSpeech("彼は「やります。」と言った。")).toEqual([
      { text: "彼は「やります。」", pause: "period" },
      { text: "と言った。", pause: "period" },
    ]);
  });
});

describe("breakLongParagraphs", () => {
  it("短い段落はそのまま", () => {
    expect(breakLongParagraphs("結論から言うと、一人に絞ることです。")).toBe("結論から言うと、一人に絞ることです。");
  });

  it("長い段落は、文の切れ目で改行する", () => {
    const a = "インスタを毎日投稿しているのに増えないのは、誰に向けた投稿かが決まっていないからです。";
    const b = "まずは届けたい一人を決めて、その人の悩みに答える投稿だけにしてみてください。";
    const c = "一か月続けると、反応の違いがはっきり分かります。";
    expect(breakLongParagraphs(a + b + c, 60)).toBe(`${a}\n${b}\n${c}`);
  });

  it("太字の途中では改行しない", () => {
    const text = "**まずは届けたい一人を決めましょう。その人の悩みに答える投稿だけにしてください。**次に進みます。";
    expect(breakLongParagraphs(text, 30)).toBe(
      "**まずは届けたい一人を決めましょう。その人の悩みに答える投稿だけにしてください。**\n次に進みます。",
    );
  });
});

describe("Codex 指摘の境界ケース", () => {
  it("全角の桁区切りでは切らない", () => {
    expect(splitForSpeech("毎月のお支払い金額は１，０００円です。")).toEqual([
      { text: "毎月のお支払い金額は１，０００円です。", pause: "period" },
    ]);
  });

  it("次の文の太字の始まりを、前の文の閉じと取り違えない", () => {
    const a = "あ".repeat(49) + "。";
    const b = "**" + "い".repeat(49) + "。**";
    expect(breakLongParagraphs(a + b)).toBe(`${a}\n${b}`);
  });

  it("《》の閉じかっこは前の文に付ける", () => {
    const a = "《" + "あ".repeat(55) + "。》";
    const b = "次の文章です。";
    expect(breakLongParagraphs(a + b)).toBe(`${a}\n${b}`);
  });
});
