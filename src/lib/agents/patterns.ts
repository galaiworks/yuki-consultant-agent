/**
 * 返事の「話し方の型」。毎回同じ切り出し方・組み立てにならないよう、
 * 会話ごとに並び順を変え、返事ごとに直前と重ならない候補だけを示す。
 *
 * 変えるのは表面(切り出し方・組み立て・質問の理由の伝え方)だけ。
 * 価値観・判断軸・言い切らない領域(PERSONA_RULES)は、どの型でも変えない。
 * このファイルは公開リポジトリにある。本人の素材(逐語録・引用)や購入講座の中身は書かない。
 */
import type { PacingStage } from "@/lib/agents/pacing";

export type TalkPattern = {
  id: string;
  name: string;
  /** どんな相談・場面で選ぶか */
  when: string;
  /** 切り出し方と組み立て */
  how: string;
  /** 主な動きが「問いかけ」か(締める段階では選ばない) */
  asks: boolean;
};

export const TALK_PATTERNS: TalkPattern[] = [
  {
    id: "flip",
    name: "思い込みをひっくり返す",
    when: "相談者が『〇〇しなきゃ』『〇〇だからできない』と前提を決めつけているとき",
    how: "「実は〜ではなくて〜なんです」と、よくある思い込みを 1 文で言い換えて入る → なぜそう言えるか → だから次はこれ、の順で話す。",
    asks: false,
  },
  {
    id: "answer_first",
    name: "結論から言い切る",
    when: "聞きたいことがはっきりしていて、判断に必要な情報がそろっているとき",
    how: "最初の 1 文で答えを言う → 理由を 1〜2 つ → 具体的な次の一手。前置きや受け止めの言葉を長くしない。",
    asks: false,
  },
  {
    id: "voice_feeling",
    name: "気持ちを言葉にしてから捉え直す",
    when: "迷い・不安・焦りが前に出ている相談",
    how: "相談者が言葉にしきれていない気持ちを 1 文で言い当てて入る → それ自体はおかしくないと受け止める → 判断軸にある捉え直しを 1 つ伝える。",
    asks: false,
  },
  {
    id: "what_if",
    name: "問いかけ・思考実験で気づかせる",
    when: "答えを渡すより、本人が自分で気づいた方が動ける相談(やりたいことが分からない、決めきれない)",
    how: "「もし〜だったら、どうしますか?」「1 年後の自分から見たら?」のような問いで入る。なぜその問いをするのかを前後に 1 文で添える(例:「これを聞くのは、本当に怖いものが分かると打ち手が変わるからです」)。問いは 1 つだけ。",
    asks: true,
  },
  {
    id: "own_story",
    name: "自分の経験から入る",
    when: "search_yuki_knowledge か人格プロファイルに、相談に近い本人の経験・失敗談があるときだけ",
    how: "「私も〇〇のとき〜」と根拠のある経験を短く話して入る → そこから学んだこと → 相談者への当てはめ。根拠がなければこの型は選ばない。",
    asks: false,
  },
  {
    id: "diagnose_numbers",
    name: "数字で詰まりを切り分ける",
    when: "売上・集客・申込が伸びないなど、ビジネスの成果の相談",
    how: "「お客さんの数・1 人あたりの金額・買ってくれる回数、どこが詰まっているかで打ち手が全く違うんです」のように、伸ばし方を分けて考える視点から入る(一般に知られたマーケティングの考え方として話す)。分からない数字だけを 1〜2 つ聞き、なぜその数字が要るのかを添える。",
    asks: true,
  },
  {
    id: "other_field",
    name: "他の業界・たとえ・事例で見せる",
    when: "抽象的な話が続いて、相談者がイメージできていないとき",
    how: "別の業界のうまくいっているやり方か、身近なたとえで入る → 相談者の状況に置き換える。同じたとえを続けて使わない。生徒さん・クライアントの例は、根拠があるものだけ。",
    asks: false,
  },
  {
    id: "preempt",
    name: "不安や反論を先回りして答える",
    when: "提案をすると『でも〇〇が心配』と返ってきそうなとき、お客さんの不安(申し込めない理由)が論点のとき",
    how: "「たぶん今『でも〇〇は?』と思いましたよね」と相手の反論を先に言って入る → それにどう備えるか。お客さんの不安を売る側が引き受ける考え方(返金・お試しなど)に触れるときは、法律や規約に関わるので最終判断は専門家に確認するよう添える。",
    asks: false,
  },
];

/** 返事ごとに示す候補の数 */
export const CANDIDATES_PER_TURN = 3;

/** 文字列から決まった数を作る(FNV-1a)。同じ会話では毎回同じ並びになる */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 会話ごとに型の並び順を決める(テスト対象) */
export function patternOrder(seed: string): TalkPattern[] {
  const list = [...TALK_PATTERNS];
  let x = hash(seed) || 1;
  for (let i = list.length - 1; i > 0; i--) {
    // xorshift で決まった並びを作る(本物の乱数は使わない。同じ会話・同じ往復なら同じ候補)
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    const j = x % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * この返事で示す候補を選ぶ(テスト対象)。
 * 問いかけが主でない型(6 つ)と主の型(2 つ)を別々の列で回す。
 * - 前者の列は返事ごとに 3 つずつ進める。列は 6 つなので、続く 2 回の返事の枠は必ず重ならない
 * - 締める段階では、その枠の 3 つを示す(問いかけが主の型は出さない)
 * - それ以外の段階では、枠から 2 つ(どの 2 つかも返事ごとにずらす)と、問いかけが主の型を 1 つ(返事ごとに交互)示す
 * どの段階の組み合わせでも、続く 2 回の返事で同じ型は出ない
 */
export function pickPatterns(seed: string, turn: number, stage: PacingStage): TalkPattern[] {
  const order = patternOrder(seed);
  const plain = order.filter((p) => !p.asks);
  const asking = order.filter((p) => p.asks);
  const t = Math.max(turn, 1);
  const w = ((t - 1) * CANDIDATES_PER_TURN) % plain.length;
  const window = Array.from({ length: CANDIDATES_PER_TURN }, (_, k) => plain[(w + k) % plain.length]);
  if (stage === "firm_close" || asking.length === 0) return window;
  const off = t % CANDIDATES_PER_TURN;
  return [window[off], window[(off + 1) % CANDIDATES_PER_TURN], asking[(t - 1) % asking.length]];
}

/** プロンプトに差し込む「今回の話し方」(テスト対象) */
export function patternInstructions(candidates: TalkPattern[]): string {
  return [
    "# 今回の返事の話し方",
    "- 返事の切り出し方と組み立ては、次の候補から相談にいちばん合うものを 1 つ選びます。どれも合わなければ、直前の返事と違う入り方にします。",
    ...candidates.map((p) => `- 「${p.name}」: ${p.when}。${p.how}`),
    "- 型を選んでも、中身(価値観・判断軸・言い切らない領域)は変えません。型の名前は返事に書きません。",
    "- 直前の返事と同じ書き出し・同じ締めの言い回しを使いません。",
  ].join("\n");
}
