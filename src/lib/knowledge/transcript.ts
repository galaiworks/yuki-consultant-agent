/** 字幕(SRT / WebVTT)とプレーンテキストを、検索用のかたまりに分ける */

export type Cue = { startSec: number; endSec: number; text: string };
export type Chunk = { index: number; content: string; startSec: number | null; endSec: number | null };

function toSec(ts: string): number {
  // 00:01:02,345 / 00:01:02.345 / 01:02.345
  const parts = ts.trim().replace(",", ".").split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return Math.floor(h * 3600 + m * 60 + s);
}

/** SRT と WebVTT のどちらも読める */
export function parseSubtitles(raw: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = raw.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i === -1) continue;
    const [start, end] = lines[i].split("-->").map((s) => s.trim().split(" ")[0]);
    const text = lines
      .slice(i + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) cues.push({ startSec: toSec(start), endSec: toSec(end), text });
  }
  return cues;
}

/** 字幕を約 maxChars 文字ごとにまとめる。開始秒を残すので出典から該当場面に飛べる */
export function chunkCues(cues: Cue[], maxChars = 500): Chunk[] {
  const chunks: Chunk[] = [];
  let buf: Cue[] = [];
  const flush = () => {
    if (!buf.length) return;
    chunks.push({
      index: chunks.length,
      content: buf.map((c) => c.text).join(" "),
      startSec: buf[0].startSec,
      endSec: buf[buf.length - 1].endSec,
    });
    buf = [];
  };
  for (const cue of cues) {
    const size = buf.reduce((n, c) => n + c.text.length, 0);
    if (size + cue.text.length > maxChars) flush();
    buf.push(cue);
  }
  flush();
  return chunks;
}

/** プレーンテキストを段落単位で約 maxChars 文字にまとめる */
export function chunkText(raw: string, maxChars = 500): Chunk[] {
  const paras = raw.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length > maxChars) {
      chunks.push({ index: chunks.length, content: buf, startSec: null, endSec: null });
      buf = "";
    }
    buf = buf ? `${buf}\n${p}` : p;
  }
  if (buf) chunks.push({ index: chunks.length, content: buf, startSec: null, endSec: null });
  return chunks;
}
