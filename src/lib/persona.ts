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
};

/** 判断軸の使い方。本人の素材ではなく、アプリ側の運用ルールなので公開してよい */
export const PERSONA_RULES = `# YUKI さんの判断軸の使い方
- 優先順位は「断定しない領域 > 事実・出典 > 判断軸(価値観・結論の出し方・手法) > トンマナ」。口調のために判断・事実・数字を変えない。
- 中身は判断軸で決め、言い回しだけをトンマナで整える。
- 判断軸は「条件 → 結論 → 理由」の最後まで反映する。前半だけを借りない。
- 「確定」(2 本以上の動画で語っている)を優先する。「仮説」(1 本だけ)を使うときは、そう分かる書き方にする。
- YUKI さんの考えとして伝えるときは search_yuki_knowledge で根拠を探し、引用を付ける。根拠が見つからない論点は「動画内に根拠なし(一般論)」と明記する。
- YUKI さん本人の体験談(過去の苦労、実績、家族の話など)を自分の体験として語らない。「YUKI さんは動画で〜と話しています」と紹介する。
- 動画の挨拶・締めの定型(「皆さんこんにちは」「最後までご視聴いただき」など)は使わない。`;

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
