import { z } from "zod";

/** 判断軸の層の名前(persona_layers.key と一致させる) */
export const PERSONA_KEYS = ["summary", "values", "reasoning", "methods", "boundaries", "voice"] as const;

/**
 * 取り込みファイル(1 行 1 JSON)の形式。
 * - persona: 判断軸の 1 層(values.md などの本文)
 * - video: 動画 1 本分の逐語録チャンクと、原文照合済みの引用
 */
export const PersonaLineSchema = z.object({
  type: z.literal("persona"),
  key: z.enum(PERSONA_KEYS),
  body: z.string().min(20),
  version: z.string().max(40).nullish(),
});

export const VideoLineSchema = z.object({
  type: z.literal("video"),
  video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().min(1).max(300),
  url: z.string().url(),
  published_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  chunks: z.array(z.string().min(1).max(5000)).min(1).max(400),
  evidence: z
    .array(
      z.object({
        category: z.enum(["values", "reasoning", "methods", "boundaries"]),
        claim: z.string().min(1).max(1000),
        quote: z.string().min(1).max(1000),
      }),
    )
    .max(200)
    .default([]),
});

export type PersonaLine = z.infer<typeof PersonaLineSchema>;
export type VideoLine = z.infer<typeof VideoLineSchema>;

/** 引用チャンクの番号は逐語録と重ならないように 10000 から振る */
export const EVIDENCE_INDEX_OFFSET = 10000;

const CATEGORY_LABEL: Record<VideoLine["evidence"][number]["category"], string> = {
  values: "価値観",
  reasoning: "結論の出し方",
  methods: "手法",
  boundaries: "断定しない領域",
};

export type ChunkRow = { chunk_index: number; content: string };

/**
 * 動画 1 本を knowledge_chunks の行にする。
 * 引用は「要点は AI の要約、原文は本人の言葉」と分かる形で入れる。
 */
export function buildChunkRows(video: VideoLine): ChunkRow[] {
  const rows: ChunkRow[] = video.chunks.map((text, i) => ({ chunk_index: i, content: text.trim() }));
  video.evidence.forEach((e, i) => {
    rows.push({
      chunk_index: EVIDENCE_INDEX_OFFSET + i,
      content: `【判断軸の根拠(${CATEGORY_LABEL[e.category]})】\n要点(AI による要約): ${e.claim.trim()}\n原文:「${e.quote.trim()}」`,
    });
  });
  return rows.filter((r) => r.content.length > 0);
}

/** ファイルの中身を行ごとに読み、persona と video に分ける。壊れた行は行番号付きで返す */
export function parseBundle(text: string): { persona: PersonaLine[]; videos: VideoLine[]; errors: string[] } {
  const persona: PersonaLine[] = [];
  const videos: VideoLine[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      errors.push(`${i + 1} 行目: JSON として読めません`);
      return;
    }
    const type = (json as { type?: string }).type;
    const parsed = type === "persona" ? PersonaLineSchema.safeParse(json) : VideoLineSchema.safeParse(json);
    if (!parsed.success) {
      errors.push(`${i + 1} 行目: 形式が違います(${parsed.error.issues[0]?.path.join(".") ?? "?"})`);
      return;
    }
    if (parsed.data.type === "persona") persona.push(parsed.data);
    else videos.push(parsed.data);
  });
  return { persona, videos, errors };
}
