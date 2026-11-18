export type Conversation = { id: string; title: string | null; updated_at: string };
export const SESSION_PAGE_SIZE = 50;

/** 会話を重複なく新しい順に並べる。同時刻の会話も ID で順序を固定する */
export function mergeConversations(...pages: Conversation[][]): Conversation[] {
  const rows = new Map<string, Conversation>();
  for (const page of pages) for (const row of page) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
}

/** 先読みした 1 件を「もっと見る」の判定に使う */
export function conversationPage(rows: Conversation[]) {
  const sorted = mergeConversations(rows);
  return { items: sorted.slice(0, SESSION_PAGE_SIZE), hasMore: sorted.length > SESSION_PAGE_SIZE };
}

/** 既存の声の会話の題名から目印と表示用の題名を取り出す */
export function conversationLabel(title: string | null) {
  return { voice: Boolean(title?.startsWith("(声)")), title: title?.replace(/^\(声\)/, "") || "相談" };
}

const THINKING = [
  "ちょっと考えてますね",
  "いい質問ですね、整理してみます",
  "関係しそうな話を探しています",
  "どこから取り組むとよいか、考えています",
] as const;

/** 待機中の一言を順に選び、直前と同じ言い回しを続けない */
export function nextThinkingLine(previous = ""): string {
  return THINKING[(THINKING.findIndex((line) => line === previous) + 1) % THINKING.length];
}

/** 下端近くを読んでいるときだけ、新しい返事に追従する */
export function isNearLogBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 80;
}
