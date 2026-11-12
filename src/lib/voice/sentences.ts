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
  | { type: "audio"; index: number; audio: string }
  | { type: "done"; replyText: string; timings: Record<string, number> }
  | { type: "error"; error: string };
