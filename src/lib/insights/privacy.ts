import { z } from "zod";

export const INSIGHTS_MIN_USERS = 5;
export const INSIGHTS_CONSENT_TEXT = "サービスの改善のため、個人が特定されない形で、相談の傾向(テーマ)を使うことに同意します。いつでも取り消せます。";
export const INSIGHT_CATEGORIES = ["集客", "商品", "マインドセット", "キャリア", "お金", "人間関係", "その他"] as const;

export type InsightPattern = { theme: string; pattern: string; category: (typeof INSIGHT_CATEGORIES)[number] };
export type InsightTopic = InsightPattern & {
  id: string;
  user_count: number;
  status: "draft" | "approved" | "rejected";
  video_gap: boolean;
  updated_at: string;
};

/** AI に渡す前と保存前に連絡先・数字・敬称つきの人名・住所・会社表記を消す。 */
export function redactInsightText(text: string, identifiers: string[] = []): string {
  let normalized = text.normalize("NFKC");
  for (const identifier of identifiers.filter((s) => s.trim().length > 0).sort((a, b) => b.length - a.length)) {
    normalized = normalized.replaceAll(identifier.normalize("NFKC"), "[個人情報]");
  }
  return normalized
    .replace(/(?:https?:\/\/|www\.)[^\s<>「」]+/giu, "[URL]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[メール]")
    .replace(/(?:\+?\d[\d()\s-]{7,}\d)/gu, "[電話]")
    .replace(/(?:株式会社|有限会社|合同会社|一般社団法人|一般財団法人)[\p{L}\p{N}ー・]+|[\p{L}\p{N}ー・]+(?:株式会社|有限会社|合同会社)/gu, "[会社]")
    .replace(/[\p{L}ー・]+(?:さん|さま|様|氏|先生|社長|代表|部長)/gu, "[人名]")
    .replace(/\b(?:[A-Z][a-z]+\s+){1,3}[A-Z][a-z]+\b/gu, "[人名]")
    .replace(/(?:東京都|北海道|(?:京都|大阪)府|[\p{Script=Han}]{2,3}県)[^\s、。\n]*/gu, "[住所]")
    .replace(/(?:[$¥€£]\s*)?\d+(?:[,.，．]\d+)*(?:\s*(?:万円|億円|千円|円|ドル|人|名|社|件|%|パーセント))?|[一二三四五六七八九十百千万億兆]+(?:万円|億円|千円|円|ドル|人|名|社|件|パーセント)/gu, "[数値]");
}

const Extraction = z.object({
  theme: z.string().trim().min(1).max(100), pattern: z.string().trim().min(1).max(300), category: z.enum(INSIGHT_CATEGORIES),
}).strict().nullable();

/** 自由なテーマを抽出するが、識別子を消し込んでから再検証する。生の AI 応答は保存しない。 */
export function parseInsightExtraction(text: string): InsightPattern | null {
  const value = Extraction.parse(JSON.parse(text));
  if (value === null) return null;
  const normalized = { theme: value.theme.normalize("NFKC"), pattern: value.pattern.normalize("NFKC"), category: value.category };
  const safe = { theme: redactInsightText(normalized.theme), pattern: redactInsightText(normalized.pattern), category: value.category };
  // 消し込みが必要だった文は断片が残るおそれがあるため、伏せ字を保存する代わりに処理を止める。
  if (safe.theme !== normalized.theme || safe.pattern !== normalized.pattern || /[\[\]<>「」『』@]/u.test(safe.theme + safe.pattern)) throw new Error("insight_contains_identifiers");
  if (safe.pattern.split(/[。！？!?]/u).filter((s) => s.trim()).length > 3) throw new Error("insight_pattern_too_long");
  return safe;
}

/** 人数は会話数でなく、同意中の異なる利用者の数。取り消した人の全会話を除外する。 */
export function countInsightUsers(sources: { user_id: string }[], excludedUserId?: string): number {
  return new Set(sources.filter((s) => s.user_id !== excludedUserId).map((s) => s.user_id)).size;
}

/** 管理画面と書き出しの共通境界。人数と、保存済みの文面の再検証を必須にする。 */
export function visibleInsightTopics(topics: InsightTopic[], approvedOnly = false): InsightTopic[] {
  return topics.filter((t) => {
    if (t.user_count < INSIGHTS_MIN_USERS || (approvedOnly && t.status !== "approved")) return false;
    try { return parseInsightExtraction(JSON.stringify({ theme: t.theme, pattern: t.pattern, category: t.category })) !== null; }
    catch { return false; }
  })
    .sort((a, b) => b.user_count - a.user_count || a.id.localeCompare(b.id));
}

/** 承認済み・匿名の傾向だけを、配布できる Markdown にする。内部 ID や元の相談は含めない。 */
export function exportInsightMarkdown(topics: InsightTopic[]): string {
  return ["# 相談の傾向（運営承認済み）", "", "講座・動画・サービスの改善用です。別の利用者への回答には使いません。", "",
    ...visibleInsightTopics(topics, true).flatMap((t) => [
      `## ${t.theme}`, "", t.pattern, "", `- カテゴリ: ${t.category}`, `- 人数: ${t.user_count} 人`,
      `- 動画で未回答: ${t.video_gap ? "はい" : "いいえ"}`, "",
    ]),
  ].join("\n");
}
