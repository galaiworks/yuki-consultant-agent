/** 文の終わりとみなす文字。ここで区切って、書けた文から順に声にする */
const END = /[。！？!?…\n]/;

/**
 * Claude の返事を少しずつ受け取り、言い終わった文ごとに取り出す(テスト対象)。
 * 短すぎる文(「はい。」など)は次の文とまとめ、細切れで声の調子が崩れないようにする。
 */
export class SentenceSplitter {
  private buf = "";

  constructor(private readonly minChars = 10) {}

  /** 新しく届いた文字を足し、言い終わった文があれば返す */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      if (!END.test(this.buf[i])) continue;
      // 「。」「！？」が続くときは最後の記号までを 1 文にする
      while (i + 1 < this.buf.length && END.test(this.buf[i + 1])) i++;
      const sentence = this.buf.slice(start, i + 1).trim();
      if (sentence.length >= this.minChars) {
        out.push(sentence);
        start = i + 1;
      }
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** 返事が書き終わったら、残りを最後の文として返す */
  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    return rest || null;
  }
}

/** /api/voice/turn が 1 行 1 JSON で順に送るイベント */
export type VoiceEvent =
  | { type: "heard"; conversationId: string; userText: string }
  | { type: "text"; index: number; text: string }
  | { type: "audio"; index: number; audio: string; pauseMs: number }
  | { type: "done"; replyText: string; timings: Record<string, number> }
  | { type: "error"; error: string };

/** 読み上げを区切る記号。読点のあとは短め、句点などのあとは長めに間を置く */
const COMMA = /[、，]/;
const PERIOD = /[。！？!?…\n]/;
/** 句読点のすぐあとに付く閉じかっこ(「〜です。」の 」など)は前の区切りに含める */
const CLOSER = /[」』）)】〉》"'”’]/;
const DIGIT = /[0-9０-９]/;

export type SpeechPart = { text: string; pause: "comma" | "period" | "none" };

/**
 * 声にする文を、読点・句点ごとの小さな区切りに分ける(テスト対象)。
 * 区切りごとに声を作り、そのあいだに決まった長さの無音を挟むことで「間」をつくる。
 * 読点で切ったときに短すぎる区切り(「はい、」など)は、次とまとめて不自然に途切れないようにする。
 * 半角の「,」と、数字に挟まれた「，」「、」は桁区切りなので区切りにしない。
 */
export function splitForSpeech(text: string, minCommaChars = 8): SpeechPart[] {
  const out: SpeechPart[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isComma = COMMA.test(ch);
    if (!isComma && !PERIOD.test(ch)) continue;
    // 数字に挟まれた読点・カンマ(１，０００ など)は桁区切りなので切らない
    if (isComma && DIGIT.test(text[i - 1] ?? "") && DIGIT.test(text[i + 1] ?? "")) continue;
    let end = i;
    let pause: SpeechPart["pause"] = isComma ? "comma" : "period";
    // 記号が続くとき(「！？」「。」」など)は最後までを 1 つにする。句点が混じれば長い間にする
    while (end + 1 < text.length && (COMMA.test(text[end + 1]) || PERIOD.test(text[end + 1]) || CLOSER.test(text[end + 1]))) {
      end++;
      if (PERIOD.test(text[end])) pause = "period";
    }
    const piece = text.slice(start, end + 1).trim();
    i = end;
    if (!piece) {
      start = end + 1;
      continue;
    }
    if (pause === "comma" && piece.length < minCommaChars) continue; // 短い読点区切りは次とまとめる
    out.push({ text: piece, pause });
    start = end + 1;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push({ text: rest, pause: "none" });
  return out;
}
