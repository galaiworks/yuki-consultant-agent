// PostToolUse フック: TS ファイルを編集したら型チェックし、エラーがあれば Claude に返す
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const input = JSON.parse(readFileSync(0, "utf8"));
const file = input?.tool_input?.file_path ?? "";
if (!/\.(ts|tsx)$/.test(file)) process.exit(0);

const r = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], { encoding: "utf8" });
if (r.status !== 0) {
  console.error(`型エラーがあります:\n${(r.stdout + r.stderr).split("\n").slice(0, 30).join("\n")}`);
  process.exit(2);
}
