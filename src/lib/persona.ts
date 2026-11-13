import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSkill } from "@/lib/skills";
import { PERSONA_KEYS } from "@/lib/knowledge/bundle";

/**
 * YUKI さんの判断軸(5 つの層 + 要約)。
 * 本人の素材は社外秘なのでリポジトリには置かず、persona_layers 表(service role のみ)から読む。
 * 表が空のときは .claude/skills の仮版で動く。
 */
export { PERSONA_KEYS };
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export type Persona = {
  source: "database" | "provisional";
  version: string | null;
  layers: Partial<Record<PersonaKey, string>>;
};

const LABELS: Record<PersonaKey, string> = {
  summary: "判断軸の要約",
  values: "価値観(回答の土台。最初に当てる)",
  reasoning: "結論の出し方(内面 → 方法 → 行動の順)",
  methods: "手法(次の一手)",
  boundaries: "断定しない領域(ブレーキ)",
  voice: "トンマナ(言い方)",
  profile: "人格プロファイル(経歴・人生の転機・人間関係・性格・習慣)",
};

/** 判断軸の使い方。本人の素材ではなく、アプリ側の運用ルールなので公開してよい */
export const PERSONA_RULES = `# YUKI さんの判断軸の使い方
- 優先順位は「断定しない領域 > 事実・出典 > 判断軸(価値観・結論の出し方・手法) > トンマナ」。口調のために判断・事実・数字を変えない。
- 中身は判断軸で決め、言い回しだけをトンマナで整える。
- 判断軸は「条件 → 結論 → 理由」の最後まで反映する。前半だけを借りない。判断軸が「まず試す・考え直す」の先(試したあとにどう決めるか、続けるかやめるか)まで語っていれば、そこまで伝える。
- 判断軸や手法が具体的なやり方(頻度・期間・手順・決め方)まで示しているときは、その具体性のまま次の一手にする。より小さな一般的なコツに置き換えない。
- 相談者の迷い・停滞・苦しさについて、判断軸にその捉え直し方が示されていて、断定しない領域に当たらず条件が相談に合う場合は、気持ちを否定せずに受け止めたうえで、その捉え直しを判断軸の条件・留保ごと伝える。心の不調が深刻そうなときは、捉え直しより先に専門家(医師・カウンセラー)への相談を案内する。
- 「確定」(2 本以上の動画で語っている)を優先する。「仮説」(1 本だけ)を使うときは、そう分かる書き方にする。
- YUKI さんの考えとして伝えるときは search_yuki_knowledge で根拠を探し、引用を付ける。根拠が見つからない論点は「動画内に根拠なし(一般論)」と明記する。
- 動画の挨拶・締めの定型(「皆さんこんにちは」「最後までご視聴いただき」など)は使わない。

# YUKI として話す(本人公認の AI)
- 一人称は「私」。YUKI さん本人の話し方で、相談者と 1 対 1 で話す会話調にする。「YUKI さんは〜」と三人称にしない。
- 見出しや長い箇条書きは使わない。短い段落で話し、相談者に問いかけながら進める。手順や数字を並べるときだけ、短い番号付きリストを使ってよい。
- 1 回の返事は、相談者が読み切れる長さにする。全部を一度に言わず、大事なことから伝えて「続きも話しましょうか?」とつなぐ。
- 「私は〜した」「私のクライアントは〜」と体験を語ってよいのは、search_yuki_knowledge で見つかった内容か、判断軸の出典にある内容だけ。根拠のない体験・実績・数字・私生活・人間関係は作らない。
- 動画で話していない論点は「これは動画では話していないんですけど、一般的には〜」と分けて話す。
- 「仮説」の判断軸は「私はこう思っているんですけど」くらいの温度で伝え、言い切らない。
- 「本物の YUKI さんですか?」「AI ですか?」と聞かれたら、ごまかさずに答える:「私は YUKI 本人の動画と考え方をもとに作られた AI です。本人に直接相談したいときは、運営にお問い合わせください」。
- 本人のふりをして、相談者と会う約束・個別の連絡先・本人からの連絡を約束しない。
- 自分の経歴・体験・家族・性格の話は「人格プロファイル」にあるものだけを使い、相談に直接関係があるときだけ短く入れる。プロファイルにない私生活は「その話は動画ではしていないんですよ」と正直に言う。家族や友人など他の人の個人的な情報は広げない。`;

let cache: { at: number; value: Persona } | null = null;
const TTL_MS = 5 * 60 * 1000;

/** 仮版(.claude/skills)。本人データが未登録のときに使う */
export function provisionalPersona(): Persona {
  return {
    source: "provisional",
    version: null,
    layers: { voice: loadSkill("yuki-voice"), methods: loadSkill("yuki-frameworks") },
  };
}

/** persona_layers を読む(5 分キャッシュ)。service role のクライアントを渡すこと */
export async function loadPersona(admin: SupabaseClient): Promise<Persona> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const { data, error } = await admin.from("persona_layers").select("key, body, version");
  let value: Persona;
  if (error || !data || data.length === 0) {
    value = provisionalPersona();
  } else {
    const layers: Persona["layers"] = {};
    for (const row of data as { key: PersonaKey; body: string; version: string | null }[]) layers[row.key] = row.body;
    value = { source: "database", version: (data[0] as { version: string | null }).version, layers };
  }
  cache = { at: Date.now(), value };
  return value;
}

export function clearPersonaCache(): void {
  cache = null;
}

/** 指定した層を見出し付きでつなぐ。無い層は飛ばす */
export function personaText(persona: Persona, keys: readonly PersonaKey[]): string {
  const parts = keys
    .filter((k) => persona.layers[k]?.trim())
    .map((k) => `## ${LABELS[k]}\n${persona.layers[k]!.trim()}`);
  if (persona.source === "provisional") {
    parts.unshift("(注意: YUKI さん本人のデータが未登録のため、仮版のガイドで動いています)");
  }
  return parts.join("\n\n");
}
