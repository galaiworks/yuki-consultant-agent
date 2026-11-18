"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";

export type InsightReviewState = { ok?: string; error?: string };

/** 運営による承認・却下のみを許す。人数条件は DB 内で取り消し処理と直列化して確認する。 */
export async function reviewInsightAction(_prev: InsightReviewState, form: FormData): Promise<InsightReviewState> {
  const { admin, user } = await requireAdmin();
  const input = z.object({ id: z.string().uuid(), status: z.enum(["approved", "rejected"]) })
    .safeParse({ id: form.get("id"), status: form.get("status") });
  if (!input.success) return { error: "対象が正しくありません。" };
  const { data, error } = await admin.rpc("review_insight_topic", {
    p_topic_id: input.data.id, p_status: input.data.status, p_reviewer_id: user.id,
  });
  if (error || data !== true) return { error: "更新できませんでした。対象が削除されたか、5人未満になった可能性があります。一覧を更新してください。" };
  revalidatePath("/admin");
  return { ok: input.data.status === "approved" ? "承認しました。" : "却下しました。" };
}
