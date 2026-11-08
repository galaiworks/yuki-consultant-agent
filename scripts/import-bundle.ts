/**
 * YUKI さんの取り込みファイル(yuki-knowledge-bundle.jsonl)を、ターミナルから本番 DB に入れる。
 * 管理画面の「YUKI さんのデータを取り込む」と同じ処理。
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... \
 *     npx tsx scripts/import-bundle.ts ~/Desktop/yuki-knowledge-bundle.jsonl
 *
 * 普段は scripts/setup.sh import から呼ぶ(キーを画面に出さずに入力できる)。
 */
import { readFileSync } from "node:fs";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { parseBundle } from "../src/lib/knowledge/bundle";
import { clearTestSamples, importPersona, importVideo, knowledgeTablesReady } from "../src/lib/knowledge/import";

const file = process.argv[2];
if (!file) {
  console.error("使い方: npx tsx scripts/import-bundle.ts <yuki-knowledge-bundle.jsonl のパス>");
  process.exit(1);
}

const { persona, videos, errors } = parseBundle(readFileSync(file, "utf8"));
if (errors.length) {
  console.error(`ファイルを読めませんでした:\n${errors.slice(0, 5).join("\n")}`);
  process.exit(1);
}

const admin = createSupabaseAdminClient();
if (!(await knowledgeTablesReady(admin))) {
  console.error("先に SQL を実行してください(scripts/setup.sh sql)。素材を守る設定が入る前は取り込みません");
  process.exit(1);
}
if (!process.env.VOYAGE_API_KEY) console.warn("※ VOYAGE_API_KEY が無いので、意味での検索なし(文字の一致だけ)で取り込みます");

if (persona.length) {
  await importPersona(admin, persona, null);
  console.log(`判断軸 ${persona.length} 層を保存しました`);
}

let ok = 0;
const failed: string[] = [];
for (const [i, v] of videos.entries()) {
  try {
    const r = await importVideo(admin, v);
    ok += 1;
    process.stdout.write(`\r動画 ${i + 1}/${videos.length}(チャンク ${r.chunks} 件${r.embedded ? "・意味検索あり" : ""})   `);
  } catch (err) {
    failed.push(`${v.title}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n動画 ${ok} 本を登録しました`);
if (failed.length) {
  console.error(`失敗 ${failed.length} 件(もう一度実行すれば入れ直せます):\n${failed.join("\n")}`);
  process.exit(1);
}
const deleted = await clearTestSamples(admin);
console.log(`テスト用サンプルを ${deleted} 件削除しました。完了です`);
