import { readFileSync } from "node:fs";
import path from "node:path";

export type SkillName = "yuki-voice" | "yuki-frameworks" | "consult-flow";

const cache = new Map<SkillName, string>();

/**
 * .claude/skills/<name>/SKILL.md の本文(frontmatter を除く)を読む。
 * 開発時の Claude Code と本番エージェントが同じファイルを使う。
 */
export function loadSkill(name: SkillName): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const file = path.join(process.cwd(), ".claude", "skills", name, "SKILL.md");
  const body = stripFrontmatter(readFileSync(file, "utf8")).trim();
  cache.set(name, body);
  return body;
}

export function stripFrontmatter(md: string): string {
  return md.startsWith("---") ? md.replace(/^---\n[\s\S]*?\n---\n?/, "") : md;
}
