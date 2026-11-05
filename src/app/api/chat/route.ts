import { after } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAccessForCurrentUser } from "@/lib/access";
import { recordUsage } from "@/lib/usage";
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
  if (!conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: message.slice(0, 40) })
      .select("id")
      .single();
    if (error) return Response.json({ error: "相談を開始できませんでした" }, { status: 500 });
    conversationId = data.id as string;
  }

  const [profileRes, memoriesRes, historyRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, company_name, industry, annual_revenue_band, us_expansion_status")
      .eq("id", user.id)
      .single(),
    supabase.from("client_memories").select("fact").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("messages").select("role, text").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20),
  ]);

  const { error: insertErr } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, user_id: user.id, role: "user", text: message });
  if (insertErr) return Response.json({ error: "メッセージを保存できませんでした" }, { status: 500 });

  const admin = createSupabaseAdminClient();
  // YUKI さんの素材(社外秘)はクライアントから読めない。検索と判断軸はサーバー側の service role で読む
  const persona = await loadPersona(admin);
  const usageCtx = { userId: user.id, conversationId };
  const convId = conversationId;
  let queuedDeliverable = false;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      emit({ type: "conversation", id: convId });
      try {
        const result = await runLeadConsultant({
          profile: profileRes.data ?? null,
          memories: (memoriesRes.data ?? []).map((m) => m.fact as string).reverse(),
          history: ((historyRes.data ?? []) as { role: "user" | "assistant"; text: string }[]).reverse(),
          userMessage: message,
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
            emit,
          },
        });
        if (result.citations.length) emit({ type: "citations", items: result.citations });
        const { data: saved } = await supabase
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
        emit({ type: "done" });
      } catch (err) {
        console.error("chat failed", err);
        emit({ type: "error", message: "回答の作成中に問題が起きました。少し時間をおいて再度お試しください。" });
      } finally {
        controller.close();
      }
    },
  });

  // 成果物の依頼があれば、応答を返した後にこの関数の中で処理を始める
  after(async () => {
    if (queuedDeliverable) await processNextDeliverable(admin);
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
