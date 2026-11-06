import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig, VOICE } from "@/lib/config";
import { computeSpeechCost, recordSpeechUsage } from "@/lib/usage";
import { synthesize, toSpeakable } from "@/lib/voice/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 読み上げる長さの上限(文字)。長い回答は前半だけ読む */
const SPEAK_MAX_CHARS = 2500;

/**
 * 文字チャットの YUKI の返事を、YUKI の声(mp3)にして返す。
 * 本人の会話の返事だけを読める(RLS で他人のメッセージは見えない)。
 */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  if (!appConfig.voiceEnabled) return Response.json({ error: "声の読み上げはまだ準備中です" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { messageId?: unknown } | null;
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return Response.json({ error: "読み上げる回答が見つかりません" }, { status: 400 });

  const access = await getAccessForCurrentUser(supabase, user);
  if (!access.allowed) return Response.json({ error: "今月の利用上限に達しました" }, { status: 402 });

  const { data: msg } = await supabase
    .from("messages")
    .select("id, role, text, conversation_id")
    .eq("id", messageId)
    .eq("user_id", user.id)
    .single();
  if (!msg || msg.role !== "assistant") return Response.json({ error: "読み上げる回答が見つかりません" }, { status: 404 });

  const speakable = toSpeakable(msg.text as string).slice(0, SPEAK_MAX_CHARS);
  if (!speakable) return Response.json({ error: "読み上げる文章がありません" }, { status: 422 });

  try {
    const audio = await synthesize(speakable);
    await recordSpeechUsage(
      createSupabaseAdminClient(),
      { userId: user.id, conversationId: msg.conversation_id as string },
      "voice_tts",
      VOICE.model,
      computeSpeechCost({ ttsChars: speakable.length }),
    );
    return new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=3600" } });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "読み上げに失敗しました。少し時間をおいてお試しください" }, { status: 502 });
  }
}
