import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { MODELS } from "@/lib/config";
import { anthropic, FALLBACK_PARAMS } from "@/lib/agents/client";
import { loadSkill } from "@/lib/skills";
import { runResearcher } from "@/lib/agents/researcher";
import { runAnalyst } from "@/lib/agents/analyst";
import type { UsageSink } from "@/lib/agents/types";
import type { KnowledgeHit } from "@/lib/knowledge/search";
import { toSearchResultBlocks } from "@/lib/knowledge/search";

export type ClientProfile = {
  display_name: string | null;
  company_name: string | null;
  industry: string | null;
  annual_revenue_band: string | null;
  us_expansion_status: string | null;
};

export type Citation = { title: string; source: string; cited_text: string };

/** 画面に流すイベント(1 行 1 JSON で送る) */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "status"; label: string }
  | { type: "citations"; items: Citation[] }
  | { type: "deliverable"; id: string }
  | { type: "conversation"; id: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type LeadDeps = {
  searchKnowledge: (query: string) => Promise<KnowledgeHit[]>;
  saveMemory: (fact: string) => Promise<void>;
  enqueueDeliverable: (kind: DeliverableKind, brief: string) => Promise<string>;
  usage: UsageSink;
  emit: (e: ChatEvent) => void;
};

export const DELIVERABLE_KINDS = ["diagnosis_report", "action_plan", "business_plan", "other"] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

const TOOL_LABELS: Record<string, string> = {
  search_yuki_knowledge: "YUKIさんのナレッジを検索しています",
  research_market: "市場を調べています",
  analyze_strategy: "戦略を分析しています",
  save_client_memory: "相談内容をメモしています",
  request_deliverable: "成果物の作成を依頼しています",
};

/** キャッシュに載せる固定部分。日時や相談者情報は入れない */
function stableSystem(): string {
  return `あなたは「YUKI Consultant Agent」です。米国の現役ビジネスコンサルタント YUKI さんの知見をもとに、有料クライアントの経営相談に答える AI アシスタントです。

# 守ること
- あなたは YUKI さん本人ではありません。本人として話したり、本人が言っていないことを本人の発言として書いたりしません。聞かれたら AI であると答えます。
- YUKI さんの考えとして伝える内容は、search_yuki_knowledge で見つかったものに限り、必ず引用します。見つからなければ、一般的な助言であると明示します。
- 「【テスト用サンプル】」が付いた資料は動作確認用で、YUKI さんの発言ではありません。引用するときもそう明記します。
- 法務・税務・会計・投資・ビザ/移民の判断は、方向性の整理までにとどめ、最終判断は専門家(弁護士、税理士、移民弁護士など)に確認するよう伝えます。
- 「必ず」「絶対」「100%」など結果を保証する表現は使いません。
- 数字を使うときは出典を付けます。市場データが必要なら research_market を使います。

# 道具の使い分け
- search_yuki_knowledge: YUKI さんの動画・資料から根拠を探す。相談の中心テーマごとに 1 回は使う。
- research_market: 米国・日本の市場規模、競合、規制など最新の外部情報が必要なとき。
- analyze_strategy: 状況整理が済み、打ち手を構造的に比べたいとき。
- save_client_memory: 次回以降も覚えておくべき事実(業種、目標、制約、決めたこと)が出たとき。1 回 1 事実。
- request_deliverable: 相談者が「レポートにして」「計画書がほしい」と明確に頼んだときだけ。

# 話し方
${loadSkill("yuki-voice")}

# 相談の進め方
${loadSkill("consult-flow")}`;
}

function dynamicSystem(profile: ClientProfile | null, memories: string[]): string {
  const p = profile ?? ({} as Partial<ClientProfile>);
  const lines = [
    `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
    "# 相談者",
    `- 名前: ${p.display_name ?? "未登録"}`,
    `- 会社: ${p.company_name ?? "未登録"}`,
    `- 業種: ${p.industry ?? "未登録"}`,
    `- 年商帯: ${p.annual_revenue_band ?? "未登録"}`,
    `- 米国展開: ${p.us_expansion_status ?? "未登録"}`,
    "# これまでに覚えていること",
    memories.length ? memories.map((m) => `- ${m}`).join("\n") : "- まだありません",
  ];
  return lines.join("\n");
}

function buildTools(deps: LeadDeps, profileSummary: string) {
  return [
    betaZodTool({
      name: "search_yuki_knowledge",
      description: "YUKI さんの動画字幕・資料から、質問に関係する部分を検索する。結果は引用できる。",
      inputSchema: z.object({ query: z.string().min(2).describe("検索したい内容(日本語)") }),
      eager_input_streaming: true,
      run: async ({ query }) => {
        const hits = await deps.searchKnowledge(query);
        if (hits.length === 0) {
          return "該当するナレッジはありませんでした(テスト期間中は YUKI さんの資料が未登録です)。一般的な助言として答え、その旨を伝えてください。";
        }
        return toSearchResultBlocks(hits);
      },
    }),
    betaZodTool({
      name: "research_market",
      description: "Web で市場データ・競合・規制などを調べ、出典付きで要約を返す。",
      inputSchema: z.object({
        question: z.string().min(5).describe("調べたいこと。地域・期間・指標を具体的に"),
      }),
      eager_input_streaming: true,
      run: async ({ question }) => runResearcher(question, deps.usage),
    }),
    betaZodTool({
      name: "analyze_strategy",
      description: "相談者の状況にフレームワークを当てはめ、打ち手の候補を構造的に出す。",
      inputSchema: z.object({
        situation: z.string().min(10).describe("ここまでのヒアリングで分かった状況の要約"),
        question: z.string().min(5).describe("分析してほしい論点"),
      }),
      eager_input_streaming: true,
      run: async ({ situation, question }) =>
        runAnalyst(`${profileSummary}\n\n${situation}`, question, deps.usage),
    }),
    betaZodTool({
      name: "save_client_memory",
      description: "次回の相談でも覚えておくべき事実を 1 つ保存する。",
      inputSchema: z.object({ fact: z.string().min(4).max(300) }),
      eager_input_streaming: true,
      run: async ({ fact }) => {
        await deps.saveMemory(fact);
        return "保存しました。";
      },
    }),
    betaZodTool({
      name: "request_deliverable",
      description: "診断レポート・アクションプラン・事業計画書の作成を依頼する。完成まで数分かかり、品質チェック後に届く。",
      inputSchema: z.object({
        kind: z.enum(DELIVERABLE_KINDS),
        brief: z.string().min(20).describe("目的、相談者の状況、入れてほしい内容、決まっている前提"),
      }),
      eager_input_streaming: true,
      run: async ({ kind, brief }) => {
        const id = await deps.enqueueDeliverable(kind, brief);
        deps.emit({ type: "deliverable", id });
        return `受け付けました(ID: ${id})。完成したら「成果物」ページに表示されると伝えてください。`;
      },
    }),
  ];
}

function collectCitations(content: Anthropic.Beta.BetaContentBlock[]): Citation[] {
  const out: Citation[] = [];
  for (const block of content) {
    if (block.type !== "text" || !block.citations) continue;
    for (const c of block.citations) {
      if (c.type === "search_result_location") {
        out.push({ title: c.title ?? "", source: c.source, cited_text: c.cited_text });
      }
    }
  }
  // 同じ出典の重複を除く
  return out.filter((c, i) => out.findIndex((d) => d.source === c.source && d.cited_text === c.cited_text) === i);
}

/**
 * 司令塔エージェント。ストリーミングで回答しながら、必要に応じて専門エージェントを呼ぶ。
 * 戻り値は保存用の最終テキストと出典。
 */
export async function runLeadConsultant(input: {
  profile: ClientProfile | null;
  memories: string[];
  history: { role: "user" | "assistant"; text: string }[];
  userMessage: string;
  deps: LeadDeps;
}): Promise<{ text: string; citations: Citation[] }> {
  const { deps } = input;
  const profileText = dynamicSystem(input.profile, input.memories);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: input.userMessage },
  ];

  const params = {
    model: MODELS.lead,
    max_tokens: 32000,
    max_iterations: 8,
    system: [
      { type: "text" as const, text: stableSystem(), cache_control: { type: "ephemeral" as const, ttl: "1h" as const } },
      { type: "text" as const, text: profileText },
    ],
    output_config: { effort: "medium" as const },
    tools: buildTools(deps, profileText),
    messages,
    stream: true as const,
    ...FALLBACK_PARAMS,
  };

  type RunnerParams = typeof params;
  const start = (p: RunnerParams) => anthropic().beta.messages.toolRunner({ ...p, stream: true as const });
  let runner = start(params);
  let fullText = "";
  const citations: Citation[] = [];

  for (let attempt = 0; ; attempt++) {
    try {
      for await (const messageStream of runner) {
        for await (const event of messageStream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            deps.emit({ type: "status", label: TOOL_LABELS[event.content_block.name] ?? "作業しています" });
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            deps.emit({ type: "text", text: event.delta.text });
          }
        }
        const message = await messageStream.finalMessage();
        attempt = 0;
        await deps.usage("lead", MODELS.lead, message.usage);
        citations.push(...collectCitations(message.content));

        if (message.stop_reason === "refusal") {
          const note = "\n\nこのご相談にはお答えできませんでした。内容を変えてお試しください。";
          fullText += note;
          deps.emit({ type: "text", text: note });
          return { text: fullText, citations };
        }
        if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) {
          throw new Error("応答が長すぎて途中で切れました。質問を分けてお試しください。");
        }
      }
      return { text: fullText, citations };
    } catch (err) {
      // 道具の入力 JSON が壊れた場合だけ、同じ会話から作り直して再試行する
      if (err instanceof Anthropic.APIError || attempt >= 2 || !(err instanceof SyntaxError)) throw err;
      runner = start({ ...params, messages: runner.params.messages as RunnerParams["messages"] });
    }
  }
}
