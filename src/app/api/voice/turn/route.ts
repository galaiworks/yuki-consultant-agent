import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig, VOICE } from "@/lib/config";
import { computeSpeechCost, recordSpeechUsage, recordUsage } from "@/lib/usage";
import { searchKnowledge } from "@/lib/knowledge/search";
import { loadPersona } from "@/lib/persona";
import { runVoiceReply } from "@/lib/agents/voice";
import { synthesize, toSpeakable, transcribe } from "@/lib/voice/elevenlabs";
import { addThinkingPauses, bracketDepth, endsWithQuestion, SentenceSplitter, type VoiceEvent } from "@/lib/voice/sentences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;
/** これより短い発言は相づちとみなし、動画の検索を省く */
const SHORT_UTTERANCE = 8;

const ACCESS_MESSAGES = {
  no_subscription: "ご利用には有効なプランか特別チケットが必要です。",
  usage_limit_reached: "今月の利用上限に達しました。来月またはプラン変更後にご利用ください。",
} as const;

/**
 * 声の 1 往復。相談者の録音を受け取り、文字に起こし、YUKI の返事を作り、YUKI の声にして返す。
 * 待ち時間を短くするため、返事は書けた文から順に声にして、少しずつ送る(1 行 1 JSON)。
 * 相談者は最初の 1 文が届いた時点で YUKI の声を聞き始められる。
 */
export async function POST(req: Request) {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const mark = (name: string) => {
    timings[name] = Date.now() - t0;
  };
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
  mark("received_ms");

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
  mark("stt_ms");
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
  // 文字起こしの費用は、このあと返事に失敗しても記録する(待ち時間を増やさないよう、準備と同時に行う)
  const [, persona, profile, memories, historyRes, hits] = await Promise.all([
    recordSpeechUsage(admin, { userId: user.id, conversationId }, "voice_stt", VOICE.sttModel, computeSpeechCost({ sttSeconds })),
    loadPersona(admin),
    supabase.from("profiles").select("display_name, company_name, industry").eq("id", user.id).single(),
    supabase.from("client_memories").select("fact").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("messages").select("role, text").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(12),
    // 「はい」「なるほど」のような短い相づちでは動画を探さない(待ち時間を減らす)
    userText.length < SHORT_UTTERANCE ? Promise.resolve([]) : searchKnowledge(admin, userText, 4).catch(() => []),
  ]);
  const p = (profile.data ?? {}) as { display_name?: string | null; company_name?: string | null; industry?: string | null };
  const context = [
    `今日の日付: ${new Date().toISOString().slice(0, 10)}`,
    `# 相談者\n- 名前: ${p.display_name ?? "未登録"}\n- 会社: ${p.company_name ?? "未登録"}\n- 業種: ${p.industry ?? "未登録"}`,
    `# これまでに覚えていること\n${(memories.data ?? []).map((m) => `- ${m.fact as string}`).join("\n") || "- まだありません"}`,
  ].join("\n");

  mark("context_ms");
  const userId = user.id;
  const convId = conversationId;
  const ctx = { userId, conversationId: convId };

  // 相談者が画面を閉じたら false。返事の保存と費用の記録は最後まで行うが、声づくりはやめる
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      open = false;
    },
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: VoiceEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      send({ type: "heard", conversationId: convId, userText });

      // 3) 書けた文から順に YUKI の声にする。声づくりは 1 文ずつ順番に(同時に頼みすぎない)
      const splitter = new SentenceSplitter();
      let index = 0;
      let spoken = "";
      let ttsChars = 0;
      let depth = 0;
      let speech: Promise<void> = Promise.resolve();
      const speak = (sentence: string) => {
        const i = index++;
        send({ type: "text", index: i, text: sentence });
        const speakable = toSpeakable(sentence);
        const previousText = spoken;
        spoken += speakable;
        if (!speakable) return;
        // 問いのあとに話が続くときだけ、声の中に間([pause])を入れる
        const withPauses = addThinkingPauses(speakable, depth);
        depth = bracketDepth(speakable, depth); // かっこが文をまたぐときのため、深さを次の文へ持ち越す
        speech = speech.then(async () => {
          if (!open) return; // 聞く人がいない声は作らない(費用をかけない)
          try {
            const audio = Buffer.from(await synthesize(withPauses, { previousText })).toString("base64");
            ttsChars += withPauses.length;
            if (!("first_audio_ms" in timings)) mark("first_audio_ms");
            send({ type: "audio", index: i, audio });
          } catch (err) {
            console.error(err);
          }
        });
      };
      // 問いで終わる文は、次の文と一緒に声にする(あいだに間を入れるため)。最後の問いはそのまま声にする
      let held: string | null = null;
      const say = (sentence: string) => {
        const joined = `${held ?? ""}${sentence}`;
        if (endsWithQuestion(sentence)) {
          held = joined; // 問いが続くときも、問いでない文が来るまでまとめておく
        } else {
          held = null;
          speak(joined);
        }
      };

      // 2) 文字 → YUKI の返事
      let replyText = "";
      try {
        replyText = await runVoiceReply({
          persona,
          context,
          history: ((historyRes.data ?? []) as { role: "user" | "assistant"; text: string }[]).reverse(),
          userMessage: userText,
          hits: hits.filter((h) => !h.is_test),
          usage: (agent, model, u) => recordUsage(admin, ctx, agent, model, u),
          onText: (delta) => {
            if (!("first_token_ms" in timings)) mark("first_token_ms");
            for (const sentence of splitter.push(delta)) {
              if (!("first_sentence_ms" in timings)) mark("first_sentence_ms");
              say(sentence);
            }
          },
        });
        const rest = splitter.flush();
        if (rest) say(rest);
        if (held !== null) speak(held);
        mark("reply_ms");
      } catch (err) {
        console.error(err);
        send({ type: "error", error: "返事を作れませんでした。少し時間をおいてお試しください" });
      }

      if (replyText) {
        // 1 回の insert だと同じ時刻になり順番が崩れるので、相談者 → YUKI の順に別々に保存する
        await supabase.from("messages").insert({ conversation_id: convId, user_id: userId, role: "user", text: userText });
        // YUKI の返事はサーバーだけが書ける(RLS で利用者は role = 'user' しか書けない)
        await admin.from("messages").insert({ conversation_id: convId, user_id: userId, role: "assistant", text: replyText });
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
      }

      await speech;
      if (ttsChars > 0) {
        await recordSpeechUsage(admin, ctx, "voice_tts", VOICE.model, computeSpeechCost({ ttsChars }));
      }
      mark("total_ms");
      // どこで時間がかかっているかを Vercel のログで見られるようにする
      console.log(JSON.stringify({ event: "voice_turn_timing", sentences: index, ...timings }));
      if (replyText) send({ type: "done", replyText, timings });
      if (open) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
