import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({
  messageId: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * 回答への評価を保存する。
 * コメントは「その人への回答で気をつけること」として相談者メモに残し、次回以降の回答に反映する。
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  // 自分の会話の回答であることを確かめる(RLS でも守られている)
  const { data: msg } = await supabase
    .from("messages")
    .select("id, role")
    .eq("id", parsed.data.messageId)
    .single();
  if (!msg || msg.role !== "assistant") return Response.json({ error: "対象の回答が見つかりません" }, { status: 404 });

  const { error } = await supabase.from("message_feedback").upsert(
    {
      message_id: parsed.data.messageId,
      user_id: user.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment || null,
    },
    { onConflict: "message_id,user_id" },
  );
  // 評価テーブルが未作成でも、コメントの反映は続ける
  if (error) console.error("message_feedback への保存に失敗", error.message);

  if (parsed.data.comment) {
    const prefix = parsed.data.rating === 1 ? "良かった点" : "回答への要望";
    await supabase.from("client_memories").insert({ user_id: user.id, fact: `${prefix}: ${parsed.data.comment}` });
  }
  return Response.json({ ok: true });
}
