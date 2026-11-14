import { describe, expect, it } from "vitest";
import { toSpeakable } from "@/lib/voice/elevenlabs";
import { computeSpeechCost } from "@/lib/usage";
import { addThinkingPauses, bracketDepth, endsWithQuestion, SentenceSplitter } from "@/lib/voice/sentences";
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

describe("addThinkingPauses", () => {
  it("相談者への問いのあとに話が続くときだけ間を入れる", () => {
    expect(
      addThinkingPauses("あなたのお客さまは、なぜあなたから買うのでしょうか。答えにくいですよね。でも、ここが大事です。"),
    ).toBe("あなたのお客さまは、なぜあなたから買うのでしょうか。 [pause] 答えにくいですよね。でも、ここが大事です。");
    expect(addThinkingPauses("続けますか？では次へ。")).toBe("続けますか？ [pause] では次へ。");
  });
  it("最後の問い・句読点・かっこの中の問いには入れない", () => {
    expect(addThinkingPauses("まずは一人に絞りましょう。誰に届けたいですか？")).toBe("まずは一人に絞りましょう。誰に届けたいですか？");
    expect(addThinkingPauses("結論から言うと、一人に絞ることです。")).toBe("結論から言うと、一人に絞ることです。");
    expect(addThinkingPauses("「なぜ？」と聞かれます。答えは一つです。")).toBe("「なぜ？」と聞かれます。答えは一つです。");
  });
  it("かっこの中の問いには入れず、「？！」や連続する問いには入れる", () => {
    expect(addThinkingPauses("「誰に届けたいですか？その一人を想像してください」と伝えます。次へ。")).toBe(
      "「誰に届けたいですか？その一人を想像してください」と伝えます。次へ。",
    );
    expect(addThinkingPauses("どんな事業をしたいですか？！少し考えてみてください。")).toBe(
      "どんな事業をしたいですか？！ [pause] 少し考えてみてください。",
    );
    expect(addThinkingPauses("何に困っていますか？理想はどんな状態ですか？順に整理しましょう。")).toBe(
      "何に困っていますか？ [pause] 理想はどんな状態ですか？ [pause] 順に整理しましょう。",
    );
  });
  it("文を区切って渡しても、前の文から続くかっこの中には入れない", () => {
    const a = "「まずは現状を整理しましょう。";
    const b = "何に困っていますか？理想はどんな状態ですか？順に整理しましょう」と伝えます。";
    expect(addThinkingPauses(b, bracketDepth(a))).toBe(b);
    expect(bracketDepth(a + b)).toBe(0);
  });
  it("文が問いで終わるかを判定する", () => {
    expect(endsWithQuestion("本当ですか？！")).toBe(true);
    expect(endsWithQuestion("なぜ買うのでしょうか。")).toBe(true);
    expect(endsWithQuestion("続けますか？ ")).toBe(true);
    expect(endsWithQuestion("大事なところです。")).toBe(false);
  });
});
