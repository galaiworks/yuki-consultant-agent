import { after } from "next/server";
import { countPacing, decidePacing, pacingFromCounts, pacingInstructions, MODEL_HISTORY_LIMIT } from "@/lib/agents/pacing";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAccessForCurrentUser } from "@/lib/access";
import { computeSpeechCost, recordSpeechUsage, recordUsage } from "@/lib/usage";
import { appConfig, VOICE } from "@/lib/config";
import { createReplySpeech } from "@/lib/voice/reply-speech";
import { searchKnowledge } from "@/lib/knowledge/search";
import { runLeadConsultant, type ChatEvent } from "@/lib/agents/lead";
import { processNextDeliverable } from "@/lib/agents/deliverable-loop";
import { loadPersona } from "@/lib/persona";

export const runtime = "nodejs";
// 応答後に成果物ジョブも同じ関数で処理するため長めに取る(Vercel Pro)
export const maxDuration = 800;

const Body = z.object({
  conversationId: z.string().uuid().nullable(),
  message: z.string().trim().min(1).max(8000),
  speak: z.boolean().default(false),
});

const ACCESS_MESSAGES = {
  no_subscription: "ご利用には有効なプランか特別チケットが必要です。",
  usage_limit_reached: "今月の利用上限に達しました。来月またはプラン変更後にご利用ください。",
} as const;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "入力が正しくありません" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "ログインが必要です" }, { status: 401 });

  const access = await getAccessForCurrentUser(supabase, user);
  if (!access.allowed) {
    return Response.json({ error: ACCESS_MESSAGES[access.reason], reason: access.reason }, { status: 402 });
  }

  const { message } = parsed.data;
  let conversationId = parsed.data.conversationId;
  if (conversationId) {
    const { data } = await supabase.from("conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!data) return Response.json({ error: "会話が見つかりません" }, { status: 404 });
  }
  if (!conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: message.slice(0, 40) })
      .select("id")
      .single();
    if (error) return Response.json({ error: "相談を開始できませんでした" }, { status: 500 });
    conversationId = data.id as string;
  }

  const [profileRes, memoriesRes, historyRes, pacingCounts] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, company_name, industry, annual_revenue_band, us_expansion_status")
      .eq("id", user.id)
      .single(),
    supabase.from("client_memories").select("fact").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("messages").select("role, text").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(MODEL_HISTORY_LIMIT),
    // 数えられなかった項目は安全側に倒す(pacingFromCounts)
    countPacing(supabase, conversationId).catch(() => pacingFromCounts({ userCount: null, disclaimerCount: null })),
  ]);

  const { error: insertErr } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, user_id: user.id, role: "user", text: message });
  if (insertErr) return Response.json({ error: "メッセージを保存できませんでした" }, { status: 500 });

  // 往復数と断り書きは会話全体で(件数の上限なしで)数える。モデルには直近分だけを渡す
  const recentHistory = ((historyRes.data ?? []) as { role: "user" | "assistant"; text: string }[]).reverse();
  const pacing = pacingInstructions(decidePacing({ history: recentHistory, ...pacingCounts, userMessage: message }), conversationId);

  const admin = createSupabaseAdminClient();
  // YUKI さんの素材(社外秘)はクライアントから読めない。検索と判断軸はサーバー側の service role で読む
  const persona = await loadPersona(admin);
  const usageCtx = { userId: user.id, conversationId };
  const convId = conversationId;
  let queuedDeliverable = false;

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    cancel() { open = false; },
    async start(controller) {
      const emit = (e: ChatEvent) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(e) + "\n")); }
        catch { open = false; }
      };
      const speech = parsed.data.speak && appConfig.voiceEnabled ? createReplySpeech({
        isOpen: () => open,
        onAudio: emit,
        onError: () => emit({ type: "speech_error", message: "声の読み上げに失敗しました。回答は文字でお読みいただけます。" }),
      }) : null;
      emit({ type: "conversation", id: convId });
      try {
        const result = await runLeadConsultant({
          profile: profileRes.data ?? null,
          memories: (memoriesRes.data ?? []).map((m) => m.fact as string).reverse(),
          history: recentHistory,
          userMessage: message,
          pacing,
          persona,
          deps: {
            searchKnowledge: (q) => searchKnowledge(admin, q),
            saveMemory: async (fact) => {
              const { error } = await supabase.from("client_memories").insert({ user_id: user.id, fact });
              if (error) throw new Error("メモを保存できませんでした");
            },
            enqueueDeliverable: async (kind, brief) => {
              const { data, error } = await supabase
                .from("deliverables")
                .insert({ user_id: user.id, conversation_id: convId, kind, brief })
                .select("id")
                .single();
              if (error) throw new Error("成果物の依頼を保存できませんでした");
              queuedDeliverable = true;
              return data.id as string;
            },
            usage: (agent, model, u) => recordUsage(admin, usageCtx, agent, model, u),
            emit: (event) => {
              emit(event);
              if (event.type === "text") speech?.push(event.text);
            },
          },
        });
        if (result.citations.length) emit({ type: "citations", items: result.citations });
        // YUKI の返事はサーバーだけが書ける(RLS で利用者は role = 'user' しか書けない)
        const { data: saved } = await admin
          .from("messages")
          .insert({
            conversation_id: convId,
            user_id: user.id,
            role: "assistant",
            text: result.text,
            citations: result.citations,
          })
          .select("id")
          .single();
        if (saved) emit({ type: "saved", id: saved.id as string });
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
      } catch (err) {
        console.error("chat failed", err);
        emit({ type: "error", message: "回答の作成中に問題が起きました。少し時間をおいて再度お試しください。" });
      } finally {
        // 途中で回答が失敗・切断しても、作成した音声の費用を既存の月間利用料に入れる。
        const ttsChars = await speech?.finish();
        if (ttsChars) await recordSpeechUsage(admin, usageCtx, "voice_tts", VOICE.model, computeSpeechCost({ ttsChars }));
        emit({ type: "done" });
        if (open) controller.close();
      }
    },
  });

  // 成果物の依頼があれば、応答を返した後にこの関数の中で処理を始める
  after(async () => {
    if (queuedDeliverable) await processNextDeliverable(admin);
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
