/**
 * 埋め込みベクトルを作る(Voyage AI)。VOYAGE_API_KEY が無ければ null を返し、
 * 検索は文字列一致だけで動く。
 */
export async function embedTexts(
  texts: string[],
  inputType: "query" | "document",
): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || texts.length === 0) return null;
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.VOYAGE_MODEL ?? "voyage-multilingual-2",
      input: texts,
      input_type: inputType,
    }),
  });
  if (!res.ok) throw new Error(`埋め込みの作成に失敗しました (${res.status})`);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** pgvector に渡す文字列表現 */
export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
