import type { SupabaseClient } from "@supabase/supabase-js";
import { appConfig } from "@/lib/config";
import { recordUsage } from "@/lib/usage";
import { searchKnowledge, sourceUrl } from "@/lib/knowledge/search";
import { writeDeliverable } from "@/lib/agents/writer";
import { decideNextStep, evaluateDeliverable, selfReflect, type Reflection } from "@/lib/agents/guardian";
import type { UsageSink } from "@/lib/agents/types";

type DeliverableRow = {
  id: string;
  user_id: string;
  conversation_id: string | null;
  kind: string;
  brief: string;
};

/**
 * キューから 1 件取り出し、Writer → Guardian の 95 点ループで仕上げる。
 * 処理した件数(0 か 1)を返す。
 */
export async function processNextDeliverable(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.rpc("claim_next_deliverable");
  if (error) throw new Error(`キューの取得に失敗しました: ${error.message}`);
  const job = (data as DeliverableRow[] | null)?.[0];
  if (!job) return 0;

  try {
    await runQualityLoop(admin, job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("deliverables").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", job.id);
  }
  return 1;
}

async function runQualityLoop(admin: SupabaseClient, job: DeliverableRow): Promise<void> {
  const usage: UsageSink = (agent, model, u) =>
    recordUsage(admin, { userId: job.user_id, conversationId: job.conversation_id, deliverableId: job.id }, agent, model, u);

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name, company_name, industry, annual_revenue_band, us_expansion_status")
    .eq("id", job.user_id)
    .single();
  const context = JSON.stringify(profile ?? {}, null, 2);

  const hits = await searchKnowledge(admin, job.brief, 8);
  const knowledge = hits.map((h) => `- [${h.title}](${sourceUrl(h)}): ${h.content}`).join("\n");

  let content = await writeDeliverable({ kind: job.kind, brief: job.brief, context, knowledge, usage });

  for (let attempt = 0; ; attempt++) {
    const ev = await evaluateDeliverable(content, `${job.brief}\n\n${context}`, usage);
    let reflection: Reflection | undefined;
    if (!ev.forceReject && ev.total >= 95) reflection = await selfReflect(content, ev, usage);

    const step = decideNextStep(ev, attempt, reflection);
    await admin.from("evaluations").insert({
      deliverable_id: job.id,
      attempt,
      total_score: ev.total,
      axis_scores: ev.axes,
      issues: Object.values(ev.axes).flatMap((a) => a.issues),
      verdict: step.action === "escalate" ? `escalate:${step.reason}` : step.action,
      self_reflection: reflection ?? null,
    });

    if (step.action === "approve") {
      await finish(admin, job.id, appConfig.deliverableHumanReview ? "needs_review" : "approved", content, ev.total, attempt + 1);
      return;
    }
    if (step.action === "escalate") {
      await finish(admin, job.id, "escalated", content, ev.total, attempt + 1, `人の確認が必要です(${step.reason})`);
      return;
    }
    content = await writeDeliverable({
      kind: job.kind,
      brief: job.brief,
      context,
      knowledge,
      previous: { content, feedback: step.feedback },
      usage,
    });
  }
}

async function finish(
  admin: SupabaseClient,
  id: string,
  status: "approved" | "needs_review" | "escalated",
  content: string,
  score: number,
  attempts: number,
  note?: string,
): Promise<void> {
  const { error } = await admin
    .from("deliverables")
    .update({ status, content_md: content, final_score: score, attempts, error: note ?? null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`成果物の保存に失敗しました: ${error.message}`);
}
