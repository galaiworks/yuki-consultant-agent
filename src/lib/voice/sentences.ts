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

/** かっこの開き・閉じ。かっこの中の問いは相手への問いではないので間を入れない */
const OPENERS = "「『（(【〈《“‘";
const CLOSERS = "」』）)】〉》”’";
/** 問いを締める記号(「？！」のように続くときは最後までを 1 つとみなす) */
const QMARK = /[？?]/;
const TAIL = /[？?！!]/;

/**
 * 相談者へ投げかけた問いのあとに、考えてもらうための間([pause] タグ)を入れる(テスト対象)。
 * 句読点はそのまま声の作り手(ElevenLabs)に任せ、間を足すのは「問いのあとに話が続くとき」だけにする。
 * 問いの終わりは「？」「?」(「？！」なども含む)と「か。」。かっこの中の問いには入れない。
 * startDepth は、文を区切って順に渡すときに、前の文から続いているかっこの深さ。
 */
export function addThinkingPauses(text: string, startDepth = 0): string {
  let out = "";
  let depth = startDepth;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += ch;
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    let end = -1;
    if (QMARK.test(ch)) {
      end = i;
      while (end + 1 < text.length && TAIL.test(text[end + 1])) end++;
    } else if (ch === "か" && text[i + 1] === "。") {
      end = i + 1;
    }
    if (end < 0) continue;
    out += text.slice(i + 1, end + 1);
    i = end;
    // 後ろに話が続くときだけ(最後の問い・すでにタグがあるとき・閉じかっこが続くときは入れない)
    const rest = text.slice(end + 1);
    const next = rest.trimStart()[0];
    if (next && next !== "[" && !CLOSERS.includes(next)) {
      out += " [pause] ";
      i += rest.length - rest.trimStart().length;
    }
  }
  return out;
}

/** 文を読み終えたときのかっこの深さ(次の文の addThinkingPauses に渡す) */
export function bracketDepth(text: string, startDepth = 0): number {
  let depth = startDepth;
  for (const ch of text) {
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
  }
  return depth;
}

/** 文が問いで終わっているか(声の 1 ターンで、問いを次の文と一緒に声にするかの判断に使う) */
export function endsWithQuestion(sentence: string): boolean {
  return /(?:[？?][？?！!]*|か。)$/.test(sentence.trim());
}
