// PreToolUse フック: .env と適用済みマイグレーションの編集を止める
import { readFileSync, existsSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const file = input?.tool_input?.file_path ?? "";

if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".env.example")) {
  console.error(".env は手で編集してください(秘密情報のため Claude からは変更しません)");
  process.exit(2);
}
if (/supabase\/migrations\/.+\.sql$/.test(file) && existsSync(file) && input.tool_name !== "Write") {
  console.error("適用済みのマイグレーションは書き換えず、新しいマイグレーションファイルを作ってください");
  process.exit(2);
}
