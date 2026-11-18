import type { SupabaseClient } from "@supabase/supabase-js";
import { patternInstructions, pickPatterns } from "@/lib/agents/patterns";

/**
 * 会話の「締め方」と「断り書き」の回数を、履歴から機械的に決める。
 * プロンプトに「何往復目か」「断り書きを使ったか」を事実として渡し、
 * 問いかけが永遠に続く・同じ断り書きを何度も言う、を防ぐ。
 */

/** 締めに向かい始める往復数(相談者の発言の回数。今回の発言を含む) */
export const SOFT_CLOSE_TURN = 5;
/** 新しい問いかけをやめて締める往復数 */
export const FIRM_CLOSE_TURN = 8;
/** 終わりの合図で締めてよい最小の往復数 */
export const MIN_TURN_FOR_SIGNAL = 3;

/**
 * 「動画では話していない」系の断り書きを見分ける言い回し(丁寧形・助詞の違いも拾う)。
 * DB(Postgres の正規表現)でも同じ文字列で検索するので、両方で通じる書き方だけを使う
 */
export const DISCLAIMER_PATTERN_SOURCE =
  "動画(で|の中で)は?(直接)?(お?話し(し)?|触れ|言っ|取り上げ)て?(い)?(ない|ません)|動画では(し|して)(い)?(ない|ません)|動画内に根拠なし";
const DISCLAIMER = new RegExp(DISCLAIMER_PATTERN_SOURCE);

/** 相談者が話を終えようとしている合図(はっきりした言い方だけ) */
const CLOSING_SIGNALS = [/ありがとう/, /わかりました|分かりました/, /助かりました/, /参考になりました/, /やってみます|試してみます/, /以上です/, /終わります|終わりにします|失礼します/];
/** 話を終える意思がはっきりした言い方(最初の発言でも終わりとみなす) */
const EXPLICIT_END = /終わります|終わりにします|失礼します|以上です/;
/** 「最後に一つ」のように、最後の質問だと分かる言い方 */
const LAST_QUESTION = /最後に(一つ|ひとつ|1つ|１つ|だけ|もう|質問|聞|お聞き|確認)/;
/** 続けたいことが分かる言い方。これがあれば合図とみなさない */
const CONTINUE_SIGNALS = /[?？]|次に|ほかに|他に|もう少し|教えて|どう(すれば|したら|やって)|ですか|ますか|でしょうか|まだ|しないで|終わらないで|続けて/;
/** 「お客様に『ありがとう』と言われて」のような引用 */
const QUOTED = /[「『]/;

/** 断り書きが含まれているか(テスト対象) */
export function hasDisclaimer(text: string): boolean {
  return DISCLAIMER.test(text);
}

/** 話を終える意思がはっきりしているか(テスト対象)。「ありがとうございます。〇〇で困っています」のような冒頭のお礼は含めない */
export function isExplicitEnd(message: string): boolean {
  return isClosingSignal(message) && EXPLICIT_END.test(message);
}

/** 話を終えようとしている合図か(テスト対象) */
export function isClosingSignal(message: string): boolean {
  // 引用の中の言葉や、「まだ最後にしないで」のような打ち消しは合図にしない
  if (QUOTED.test(message) || /まだ|しないで|終わらないで|続けて/.test(message)) return false;
  // 「最後に一つ聞いてもいいですか?」は質問付きでも合図(答えたあとに締める)
  if (LAST_QUESTION.test(message)) return true;
  if (CONTINUE_SIGNALS.test(message)) return false;
  return CLOSING_SIGNALS.some((p) => p.test(message));
}

export type PacingStage = "explore" | "soft_close" | "firm_close";

export type PacingInput = {
  /** これまでの履歴(テスト・評価用)。本番は件数の上限なしで数えた priorUserTurns・disclaimerUsed を渡す */
  history?: { role: "user" | "assistant"; text: string }[];
  /** 今回より前の、相談者の発言の回数 */
  priorUserTurns?: number;
  /** これまでの YUKI の返事で断り書きを使ったか */
  disclaimerUsed?: boolean;
  userMessage: string;
};

export type Pacing = {
  /** 今回の発言を含む、相談者の発言の回数 */
  turn: number;
  stage: PacingStage;
  /** これまでの YUKI の返事で、断り書きをすでに使ったか */
  disclaimerUsed: boolean;
  /** 今回の発言が、話を終えようとする合図を含むか */
  closingSignal: boolean;
  /** 話を終える意思がはっきりしているか(「終わります」「失礼します」など) */
  explicitEnd: boolean;
};

/** 履歴と今回の発言から、会話の段階を決める(テスト対象) */
export function decidePacing(input: PacingInput): Pacing {
  const history = input.history ?? [];
  const turn = (input.priorUserTurns ?? history.filter((m) => m.role === "user").length) + 1;
  const closingSignal = isClosingSignal(input.userMessage);
  const disclaimerUsed = input.disclaimerUsed ?? history.some((m) => m.role === "assistant" && hasDisclaimer(m.text));
  // 話し始めて間もない(2 往復目まで)のお礼では締めない
  const wantsToClose = closingSignal && turn >= MIN_TURN_FOR_SIGNAL;
  const stage: PacingStage = turn >= FIRM_CLOSE_TURN || wantsToClose ? "firm_close" : turn >= SOFT_CLOSE_TURN ? "soft_close" : "explore";
  return { turn, stage, disclaimerUsed, closingSignal, explicitEnd: isExplicitEnd(input.userMessage) };
}

/** プロンプトに差し込む「この会話の状況」(テスト対象) */
/**
 * プロンプトに差し込む「この会話の状況」(テスト対象)。
 * seed(会話 ID など)を渡すと、今回の返事で使う話し方の候補も添える
 */
export function pacingInstructions(p: Pacing, seed?: string): string {
  const lines = [`# この会話の状況`, `- 相談者の発言は今回で ${p.turn} 回目です。`];
  if (p.turn === 1 && p.explicitEnd) {
    lines.push("- 相談者は最初の発言で話を終えようとしています。振り返りや新しい質問はせず、短く応えて終えます。");
  } else if (p.turn === 1) {
    lines.push(
      "- 新しい相談の最初の返事です。「これまでに覚えていること」に「約束:」があれば、本題に入る前に、その結果を一言で聞きます(例:「前回決めた〇〇、やってみてどうでしたか?」)。できていなくても責めず、できていたら具体的に喜びます。相談者がすでに結果を話している場合は聞き直さず、その結果に反応します。今日の相談がまったく別の話なら、振り返りは一言で済ませて本題に入ります。",
    );
  }
  if (p.stage === "explore") {
    lines.push("- まだ話を広げてよい段階です。ただし問いかけは、判断に必要な情報が足りないときだけにします。");
  } else if (p.stage === "soft_close") {
    lines.push(
      "- 締めに向かう段階です。新しい論点は広げず、今のテーマで決まったことを次の一手にまとめていきます。",
      "- 問いかけは 1 つまで。判断に必要でなければ問いかけずに返事を終えます。",
    );
  } else {
    lines.push(
      p.closingSignal && p.turn >= MIN_TURN_FOR_SIGNAL ? "- 相談者は話を終えようとしています。" : "- 十分に話した段階です。",
      "- 今回の返事で締めます。新しい質問はしません。返事を「?」で終えません。",
      "- 締め方:決まった次の一手を 1〜2 文で確認し、それを試したあとに次回一緒に考えたいテーマを 1 つだけ予告して終えます(例:「まずはこの 1 週間やってみてください。結果が出たら、次は〇〇を一緒に詰めましょう」)。",
      "- 「最後に一つ」と聞かれたら、その質問には答えます。答えたあとは問い返さずに、上の形で締めます。",
    );
  }
  lines.push(
    p.disclaimerUsed
      ? "- この会話では「動画では話していない」という断り書きをすでに使いました。もう繰り返さず、一般論は自然な言い方でそのまま話します。"
      : "- 「動画では話していない」という断り書きは、この会話で 1 回までです。",
  );
  if (seed) lines.push("", patternInstructions(pickPatterns(seed, p.turn, p.stage)));
  return lines.join("\n");
}

/** 会話全体のうち、モデルに渡す直近の件数 */
export const MODEL_HISTORY_LIMIT = 20;

/**
 * 会話全体の「相談者の発言の回数」と「断り書きを使ったか」を、件数の上限なしで DB に数えさせる。
 * モデルに渡す履歴の件数制限とは切り離す(長い会話でも最初の断り書きを忘れないため)
 */
export async function countPacing(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<{ priorUserTurns?: number; disclaimerUsed: boolean }> {
  const [users, disclaimers] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("role", "user"),
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .filter("text", "match", DISCLAIMER_PATTERN_SOURCE),
  ]);
  return pacingFromCounts({
    userCount: users.error ? null : users.count,
    disclaimerCount: disclaimers.error ? null : disclaimers.count,
  });
}

/**
 * 数えた結果を会話の状況にする(テスト対象)。
 * 数えられなかった項目は安全側に倒す:断り書きは「使用済み」(繰り返さない方が害が小さい)、
 * 往復数は undefined(呼び出し側で直近の履歴から数える)
 */
export function pacingFromCounts(c: { userCount: number | null; disclaimerCount: number | null }): {
  priorUserTurns?: number;
  disclaimerUsed: boolean;
} {
  return {
    ...(c.userCount === null ? {} : { priorUserTurns: c.userCount }),
    disclaimerUsed: c.disclaimerCount === null ? true : c.disclaimerCount > 0,
  };
}
