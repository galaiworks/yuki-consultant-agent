import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig, VOICE } from "@/lib/config";
import { computeSpeechCost, recordSpeechUsage } from "@/lib/usage";
import { pauseMsFor, synthesize, toSpeakable } from "@/lib/voice/elevenlabs";
import { splitForSpeech } from "@/lib/voice/sentences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 読み上げる長さの上限(文字)。長い回答は前半だけ読む */
const SPEAK_MAX_CHARS = 2500;
/** 同時に作る声の数。順番は保ったまま、少し先まで作っておいて待ち時間を減らす */
const PREFETCH = 3;

/** 1 行 1 JSON で順に送るイベント。声は区切りごと、pauseMs はその区切りのあとに置く無音 */
export type SpeakEvent =
  | { type: "audio"; audio: string; pauseMs: number }
  | { type: "done" }
  | { type: "error"; error: string };

/**
 * 文字チャットの YUKI の返事を、YUKI の声(mp3)にして返す。
 * 読点・句点ごとに声を作って順に送り、画面側で区切りのあいだに無音(間)を挟んで再生する。
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

  const parts = splitForSpeech(speakable);
  const admin = createSupabaseAdminClient();
  const ctx = { userId: user.id, conversationId: msg.conversation_id as string };

  // 相談者が画面を閉じたら false。そこから先の声は作らない(費用をかけない)
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      open = false;
    },
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: SpeakEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      // k 番目の声を頼む(一度だけ)。先読みした分が使われずに失敗しても、未処理のエラーにしない
      const jobs: (Promise<ArrayBuffer> | undefined)[] = [];
      const request = (k: number): Promise<ArrayBuffer> => {
        const existing = jobs[k];
        if (existing) return existing;
        const job = synthesize(parts[k].text, {
          previousText: parts.slice(0, k).map((p) => p.text).join(""),
          nextText: parts[k + 1]?.text,
        });
        job.catch(() => {});
        jobs[k] = job;
        return job;
      };
      try {
        for (let k = 0; k < parts.length; k++) {
          if (!open) break;
          const job = request(k);
          for (let j = k + 1; j < Math.min(k + PREFETCH, parts.length); j++) request(j);
          const audio = Buffer.from(await job).toString("base64");
          send({ type: "audio", audio, pauseMs: pauseMsFor(parts[k].pause) });
        }
        send({ type: "done" });
      } catch (err) {
        console.error(err);
        send({ type: "error", error: "読み上げに失敗しました。少し時間をおいてお試しください" });
      } finally {
        // 費用は、作れた声の文字数で記録する。先読みして使わなかった分も作れていれば請求されるので、
        // 頼んだ声がすべて終わるのを待ってから、成功した分だけを数える
        const settled = await Promise.allSettled(jobs.map((job) => job ?? Promise.reject(new Error("未依頼"))));
        const ttsChars = settled.reduce((sum, r, k) => (r.status === "fulfilled" ? sum + parts[k].text.length : sum), 0);
        if (ttsChars > 0) {
          await recordSpeechUsage(admin, ctx, "voice_tts", VOICE.model, computeSpeechCost({ ttsChars })).catch((e) =>
            console.error(e),
          );
        }
        try {
          controller.close();
        } catch {
          // 閉じられていれば何もしない
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
