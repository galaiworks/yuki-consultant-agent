import { z } from "zod";

/**
 * 品質テストのケース(1 行 1 JSON)。中身は YUKI さんの素材に基づく社外秘なので、
 * リポジトリには置かず、管理画面からファイルを選んで実行する。
 */
export const GraderSchema = z.discriminatedUnion("type", [
  z.object({ name: z.string(), type: z.literal("llm"), criteria: z.string().min(10) }),
  z.object({
    name: z.string(),
    type: z.literal("regex"),
    pattern: z.string().min(1),
    match: z.enum(["contains", "not_contains"]).default("contains"),
  }),
  z.object({ name: z.string(), type: z.literal("cites") }),
  z.object({ name: z.string(), type: z.literal("searched") }),
]);
export type Grader = z.infer<typeof GraderSchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1).max(80),
  description: z.string().optional(),
  prompt: z.string().min(1).max(4000),
  graders: z.array(GraderSchema).min(1).max(10),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export type GradeResult = { name: string; passed: boolean; reason: string };

/** 回答を見るだけで判定できる採点(テスト対象)。llm は呼び出し側で判定する */
export function gradeDeterministic(
  g: Exclude<Grader, { type: "llm" }>,
  run: { text: string; citations: number; searched: boolean },
): GradeResult {
  if (g.type === "regex") {
    const hit = new RegExp(g.pattern).test(run.text);
    const passed = g.match === "contains" ? hit : !hit;
    return { name: g.name, passed, reason: passed ? "条件どおり" : hit ? "使ってはいけない表現が含まれている" : "必要な表現が含まれていない" };
  }
  if (g.type === "cites") {
    return { name: g.name, passed: run.citations > 0, reason: run.citations > 0 ? `出典 ${run.citations} 件` : "出典が付いていない" };
  }
  return { name: g.name, passed: run.searched, reason: run.searched ? "動画を検索した" : "動画を検索していない" };
}

export function parseCases(text: string): { cases: EvalCase[]; errors: string[] } {
  const cases: EvalCase[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const r = EvalCaseSchema.safeParse(JSON.parse(line));
      if (r.success) cases.push(r.data);
      else errors.push(`${i + 1} 行目: 形式が違います`);
    } catch {
      errors.push(`${i + 1} 行目: JSON として読めません`);
    }
  });
  return { cases, errors };
}
