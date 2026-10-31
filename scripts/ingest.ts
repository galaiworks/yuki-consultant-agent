/**
 * YUKI さんから受け取った字幕・資料をナレッジに登録する。
 *   npm run knowledge:ingest -- --file data/video01.srt --title "動画タイトル" --url "https://www.youtube.com/watch?v=..." --date 2026-05-01
 *   npm run knowledge:ingest -- --file data/notes.txt --title "資料名" --kind document
 * 対応形式: .srt / .vtt(字幕), .txt / .md(テキスト)
 * 本人の合意・提供があるデータだけを登録すること。
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { chunkCues, chunkText, parseSubtitles } from "../src/lib/knowledge/transcript";
import { embedTexts, toPgVector } from "../src/lib/knowledge/embed";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    title: { type: "string" },
    url: { type: "string" },
    date: { type: "string" },
    kind: { type: "string", default: "youtube" },
  },
});
if (!values.file || !values.title) throw new Error("--file と --title を指定してください");
if (!["youtube", "document"].includes(values.kind!)) throw new Error("--kind は youtube か document です");

const raw = readFileSync(values.file, "utf8");
const ext = extname(values.file).toLowerCase();
const chunks = ext === ".srt" || ext === ".vtt" ? chunkCues(parseSubtitles(raw)) : chunkText(raw);
if (!chunks.length) throw new Error("取り込める文章がありませんでした");

const admin = createSupabaseAdminClient();
const { data: src, error } = await admin
  .from("knowledge_sources")
  .insert({ kind: values.kind, title: values.title, url: values.url ?? null, published_at: values.date ?? null })
  .select("id")
  .single();
if (error) throw new Error(`登録に失敗しました: ${error.message}`);

// 埋め込みは 64 件ずつ(VOYAGE_API_KEY が無ければ文字列検索のみ)
for (let i = 0; i < chunks.length; i += 64) {
  const batch = chunks.slice(i, i + 64);
  const vectors = await embedTexts(batch.map((c) => c.content), "document");
  const { error: cErr } = await admin.from("knowledge_chunks").insert(
    batch.map((c, j) => ({
      source_id: src.id,
      chunk_index: c.index,
      content: c.content,
      start_sec: c.startSec,
      end_sec: c.endSec,
      embedding: vectors ? toPgVector(vectors[j]) : null,
    })),
  );
  if (cErr) throw new Error(`本文の登録に失敗しました: ${cErr.message}`);
}
console.log(`登録しました: ${values.title}(${chunks.length} 件)`);
