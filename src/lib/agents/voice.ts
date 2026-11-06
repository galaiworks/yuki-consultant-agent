import { MODELS } from "@/lib/config";
import { anthropic, FALLBACK_PARAMS } from "@/lib/agents/client";
import { PERSONA_RULES, personaText, type Persona } from "@/lib/persona";
import { toSearchResultBlocks, type KnowledgeHit } from "@/lib/knowledge/search";
import type { UsageSink } from "@/lib/agents/types";

/** 声で話すときの決まり。文字のチャットより短く、耳で聞いて分かる形にする */
export const VOICE_RULES = `# 声で話すときの決まり
- いま相談者と声で話しています。返事は 2〜4 文、長くても 30 秒で話し終わる長さにする。
- 見出し・箇条書き・記号・URL・絵文字・カッコ書きは使わない。耳で聞いて分かる、話し言葉の文にする。
- 大事なことを 1 つだけ伝え、最後に相談者へ質問を 1 つだけ返して会話を続ける。
- 動画の出典やタイトルは読み上げない。根拠がある話は「動画でもお話ししたんですけど」くらいで自然に触れる。
- 数字は聞き取りやすい言い方にする(例: 5000万円、3か月)。英語の略語は日本語で言い換えられるなら言い換える。
- 投資・税務・法律・医療・ビザの判断は、声でも言い切らず、専門家への確認を勧める。
- 「本物の YUKI さんですか」と聞かれたら、YUKI の動画と考え方をもとに作られた AI だと正直に答える。`;

function system(persona: Persona): string {
  return `あなたは「YUKI」です。アメリカの現役コンサルタント YUKI(YouTube「yukipedia」)本人の公認を受けた AI で、本人の判断軸・動画・話し方をもとに、YUKI として有料クライアントの相談に声で答えます。

${VOICE_RULES}

${PERSONA_RULES}

# YUKI さんの判断軸
${personaText(persona, ["summary", "values", "reasoning", "methods", "boundaries", "profile"])}

# 話し方
${personaText(persona, ["voice"])}`;
}

/**
 * 声の 1 ターン分の返事を作る。道具の往復で待たせないよう、
 * 相談者の発言で先にナレッジを検索し、その結果を添えて 1 回で答える。
 */
export async function runVoiceReply(input: {
  persona: Persona;
  context: string;
  history: { role: "user" | "assistant"; text: string }[];
  userMessage: string;
  hits: KnowledgeHit[];
  usage: UsageSink;
  onText: (text: string) => void;
}): Promise<string> {
  const evidence = input.hits.length
    ? toSearchResultBlocks(input.hits)
    : [];
  const stream = anthropic().beta.messages.stream({
    model: MODELS.worker,
    max_tokens: 1024,
    system: [
      { type: "text", text: system(input.persona), cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: input.context },
    ],
    output_config: { effort: "low" },
    messages: [
      ...input.history.map((m) => ({ role: m.role, content: m.text })),
      {
        role: "user",
        content: [
          ...evidence,
          {
            type: "text" as const,
            text: evidence.length
              ? `(上は相談に関係しそうな YUKI の動画の抜粋です。使えるときだけ使ってください)\n\n${input.userMessage}`
              : `(関係する動画は見つかりませんでした。一般論として話すときはそう分かる言い方にしてください)\n\n${input.userMessage}`,
          },
        ],
      },
    ],
    ...FALLBACK_PARAMS,
  });
  let text = "";
  stream.on("text", (delta) => {
    text += delta;
    input.onText(delta);
  });
  const final = await stream.finalMessage();
  await input.usage("voice", MODELS.worker, final.usage);
  return text;
}
