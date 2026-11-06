import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig, VOICE } from "@/lib/config";
import { computeSpeechCost, recordSpeechUsage, recordUsage } from "@/lib/usage";
import { searchKnowledge } from "@/lib/knowledge/search";
import { loadPersona } from "@/lib/persona";
import { runVoiceReply } from "@/lib/agents/voice";
import { synthesize, toSpeakable, transcribe } from "@/lib/voice/elevenlabs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;

const ACCESS_MESSAGES = {
  no_subscription: "ご利用には有効なプランか特別チケットが必要です。",
  usage_limit_reached: "今月の利用上限に達しました。来月またはプラン変更後にご利用ください。",
} as const;

/**
 * 声の 1 往復。相談者の録音を受け取り、文字に起こし、YUKI の返事を作り、YUKI の声にして返す。
 */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "ログインが必要です" }, { status: 401 });
  if (!appConfig.voiceEnabled) {
    return Response.json({ error: "音声の会話はまだ準備中です(管理者が設定を進めています)" }, { status: 503 });
  }
  const access = await getAccessForCurrentUser(supabase, user);
  if (!access.allowed) {
    return Response.json({ error: ACCESS_MESSAGES[access.reason], reason: access.reason }, { status: 402 });
  }

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "音声が届きませんでした" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "1 回の録音が長すぎます。短く区切って話してください" }, { status: 413 });

  let conversationId = String(form?.get("conversationId") ?? "");
  if (conversationId && !UUID.test(conversationId)) conversationId = "";
  // 録音の長さ(秒)。費用の記録に使う。届かなければ大きさから見積もる
  const reported = Number(form?.get("durationSec"));
  const sttSeconds = Math.min(600, Math.max(1, Number.isFinite(reported) && reported > 0 ? reported : audio.size / 4000));
  const admin = createSupabaseAdminClient();

  // 1) 声 → 文字
  let userText: string;
  try {
    const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
    userText = await transcribe(audio, `voice.${ext}`);
  } catch (err) {
    await recordSpeechUsage(admin, { userId: user.id }, "voice_stt", VOICE.sttModel, computeSpeechCost({ sttSeconds }));
    console.error(err);
    return Response.json({ error: "声を文字にできませんでした。もう一度お試しください" }, { status: 502 });
  }
  if (!userText) {
    await recordSpeechUsage(admin, { userId: user.id }, "voice_stt", VOICE.sttModel, computeSpeechCost({ sttSeconds }));
    return Response.json({ error: "うまく聞き取れませんでした。もう一度お話しください" }, { status: 422 });
  }

  if (!conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: `(声)${userText.slice(0, 36)}` })
      .select("id")
      .single();
    if (error || !data) return Response.json({ error: "会話を始められませんでした" }, { status: 500 });
    conversationId = data.id as string;
  }
  // 文字起こしの費用は、このあと返事に失敗しても記録する
  await recordSpeechUsage(admin, { userId: user.id, conversationId }, "voice_stt", VOICE.sttModel, computeSpeechCost({ sttSeconds }));
  const [persona, profile, memories, historyRes, hits] = await Promise.all([
    loadPersona(admin),
    supabase.from("profiles").select("display_name, company_name, industry").eq("id", user.id).single(),
    supabase.from("client_memories").select("fact").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("messages").select("role, text").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(12),
    searchKnowledge(admin, userText, 4).catch(() => []),
  ]);
  const p = (profile.data ?? {}) as { display_name?: string | null; company_name?: string | null; industry?: string | null };
  const context = [
    `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
    `# 相談者\n- 名前: ${p.display_name ?? "未登録"}\n- 会社: ${p.company_name ?? "未登録"}\n- 業種: ${p.industry ?? "未登録"}`,
    `# これまでに覚えていること\n${(memories.data ?? []).map((m) => `- ${m.fact as string}`).join("\n") || "- まだありません"}`,
  ].join("\n");

  // 2) 文字 → YUKI の返事
  let replyText: string;
  try {
    replyText = await runVoiceReply({
      persona,
      context,
      history: ((historyRes.data ?? []) as { role: "user" | "assistant"; text: string }[]).reverse(),
      userMessage: userText,
      hits: hits.filter((h) => !h.is_test),
      usage: (agent, model, u) => recordUsage(admin, { userId: user.id, conversationId }, agent, model, u),
      onText: () => {},
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "返事を作れませんでした。少し時間をおいてお試しください" }, { status: 502 });
  }

  // 1 回の insert だと同じ時刻になり順番が崩れるので、相談者 → YUKI の順に別々に保存する
  await supabase.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "user", text: userText });
  // YUKI の返事はサーバーだけが書ける(RLS で利用者は role = 'user' しか書けない)
  await admin.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", text: replyText });
  await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

  // 3) 返事 → YUKI の声(失敗しても文字の返事は返す)
  let audioBase64: string | null = null;
  try {
    const speakable = toSpeakable(replyText);
    audioBase64 = Buffer.from(await synthesize(speakable)).toString("base64");
    await recordSpeechUsage(admin, { userId: user.id, conversationId }, "voice_tts", VOICE.model, computeSpeechCost({ ttsChars: speakable.length }));
  } catch (err) {
    console.error(err);
  }

  return Response.json({ conversationId, userText, replyText, audio: audioBase64 });
}
