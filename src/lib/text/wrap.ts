/** 文の終わり(閉じかっこまで含める) */
const SENTENCE = /[^。！？!?]*[。！？!?]+[」』）)】〉》"'”’]*|[^。！？!?]+$/g;
const BOLD = /\*\*/g;

/**
 * 長い段落を、文の切れ目で改行する(テスト対象)。
 * スマホで 3 行(1 行およそ 20〜23 字)を超えそうな段落を、読みやすい長さに分ける。
 * 太字(**…**)の途中では改行しない。文が 1 つしかない長い段落はそのまま残す。
 */
export function breakLongParagraphs(text: string, maxChars = 60): string {
  return text
    .split("\n")
    .map((line) => (line.length <= maxChars ? line : wrapLine(line, maxChars)))
    .join("\n");
}

/** 1 行を文に分ける。文の直後にある「太字の閉じ **」は、次の文ではなく前の文に付ける */
function sentencesOf(line: string): string[] {
  const out: string[] = [];
  let bold = false;
  for (const raw of line.match(SENTENCE) ?? [line]) {
    let s = raw;
    if (bold && s.startsWith("**") && out.length > 0) {
      out[out.length - 1] += "**";
      s = s.slice(2);
      bold = false;
    }
    if ((s.match(BOLD)?.length ?? 0) % 2 === 1) bold = !bold;
    if (s) out.push(s);
  }
  return out;
}

function wrapLine(line: string, maxChars: number): string {
  const out: string[] = [];
  let cur = "";
  for (const s of sentencesOf(line)) {
    const insideBold = (cur.match(BOLD)?.length ?? 0) % 2 === 1;
    if (cur.trim() && !insideBold && (cur + s).length > maxChars) {
      out.push(cur);
      cur = s.replace(/^[ \t\u3000]+/, "");
    } else {
      cur += s;
    }
  }
  if (cur) out.push(cur);
  return out.join("\n");
}
