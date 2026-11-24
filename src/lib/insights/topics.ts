import type { SupabaseClient } from "@supabase/supabase-js";
import { INSIGHTS_MIN_USERS, visibleInsightTopics, type InsightTopic } from "@/lib/insights/privacy";

/** service role で匿名の集計結果だけを読む。元データ・プロフィールは管理用の結果にも含めない。 */
export async function listInsightTopics(admin: SupabaseClient, approvedOnly = false): Promise<InsightTopic[]> {
  const rows: InsightTopic[] = [];
  for (let from = 0; ; from += 1000) {
    let query = admin.from("insight_topics")
      .select("id, theme, pattern, category, user_count, status, video_gap, updated_at")
      .gte("user_count", INSIGHTS_MIN_USERS).order("user_count", { ascending: false }).order("id").range(from, from + 999);
    if (approvedOnly) query = query.eq("status", "approved");
    const { data, error } = await query;
    if (error) throw new Error("insight_list_failed");
    rows.push(...((data ?? []) as InsightTopic[]));
    if (!data || data.length < 1000) return visibleInsightTopics(rows, approvedOnly);
  }
}
