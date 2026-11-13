import { currentUserIsAdmin } from "@/lib/admin/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordUsage } from "@/lib/usage";
import { searchKnowledge } from "@/lib/knowledge/search";
import { loadPersona } from "@/lib/persona";
import { runLeadConsultant } from "@/lib/agents/lead";
import { EvalCaseSchema, gradeDeterministic, type GradeResult } from "@/lib/evals/cases";
import { judge } from "@/lib/evals/judge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 品質テストを 1 ケース実行する(管理者のみ)。本番と同じ司令塔で回答を作り、採点して返す。
 * 会話は保存しない。費用は実行した管理者の利用料として記録する。
 */
export async function POST(req: Request) {
  const { user, isAdmin } = await currentUserIsAdmin();
  if (!user || !isAdmin) return Response.json({ error: "管理者だけが使えます" }, { status: 403 });

  const parsed = EvalCaseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "ケースの形式が違います" }, { status: 400 });
  const c = parsed.data;

  const admin = createSupabaseAdminClient();
  const usage = (agent: string, model: string, u: Parameters<typeof recordUsage>[4]) =>
    recordUsage(admin, { userId: user.id }, `eval:${agent}`, model, u);
  let searched = false;
  const started = Date.now();

  try {
    const persona = await loadPersona(admin);
    const result = await runLeadConsultant({
      profile: null,
      memories: [],
      history: [],
      userMessage: c.prompt,
      persona,
      deps: {
        searchKnowledge: (q) => {
          searched = true;
          return searchKnowledge(admin, q);
        },
        saveMemory: async () => {},
        enqueueDeliverable: async () => "eval-no-deliverable",
        usage,
        emit: () => {},
      },
    });

    const run = { text: result.text, citations: result.citations.length, searched };
    const grades: GradeResult[] = [];
    for (const g of c.graders) {
      grades.push(g.type === "llm" ? await judge(g.name, g.criteria, c.prompt, result.text, result.citations, usage) : gradeDeterministic(g, run));
    }
    return Response.json({
      id: c.id,
      passed: grades.every((g) => g.passed),
      grades,
      reply: result.text,
      citations: result.citations.map((x) => x.title),
      personaSource: persona.source,
      seconds: Math.round((Date.now() - started) / 1000),
    });
  } catch (err) {
    console.error("eval failed", err);
    return Response.json({ error: "実行中に問題が起きました" }, { status: 500 });
  }
}
