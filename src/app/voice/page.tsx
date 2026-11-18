import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig } from "@/lib/config";
import { Nav } from "@/app/nav";
import { VoiceClient } from "@/app/voice/voice-client";
import { SessionWorkspace } from "@/app/components/session-workspace";
import { SESSION_PAGE_SIZE, type Conversation } from "@/lib/ui/sessions";
import type { InitialMessage } from "@/app/chat/chat-client";

export default async function VoicePage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getAccessForCurrentUser(supabase, user);
  if (!access.allowed && access.reason === "no_subscription") redirect("/redeem");

  const { data: conversations, error: listError } = await supabase.from("conversations")
    .select("id, title, updated_at").order("updated_at", { ascending: false })
    .order("id", { ascending: false }).limit(SESSION_PAGE_SIZE + 1);
  let initial: InitialMessage[] = [];
  let activeConversation: Conversation | null = null;
  if (c) {
    const { data: conversation } = await supabase.from("conversations").select("id, title, updated_at").eq("id", c).maybeSingle();
    if (!conversation) redirect("/voice");
    activeConversation = conversation;
    const { data } = await supabase.from("messages").select("id, role, text, citations")
      .eq("conversation_id", c).order("created_at");
    initial = (data ?? []) as InitialMessage[];
  }

  return (
    <main className="shell voice-page session-page">
      <Nav />
      <SessionWorkspace key={c ?? "new"} initial={conversations ?? []} activeId={c ?? null} activeConversation={activeConversation} mode="voice">
        <header className="voice-heading">
          <span className="eyebrow">Voice session</span>
          <h1>YUKI と声で話す</h1>
        </header>
        {listError && <p className="error">会話一覧を読み込めませんでした。ページを再読み込みしてください。</p>}
        {!appConfig.voiceEnabled && <p className="notice">音声の会話は準備中です。もうしばらくお待ちください。</p>}
        {!access.allowed && <p className="error">今月の利用上限に達しました。来月またはプラン変更後にご利用ください。</p>}
        <VoiceClient key={c ?? "new"} conversationId={c ?? null} initial={initial} disabled={!access.allowed || !appConfig.voiceEnabled} />
        <p className="notice">
          この YUKI は、YUKI 本人の動画と考え方をもとに作られた AI です(本人公認)。本人がその場で話しているわけではありません。法務・税務・投資・医療の判断は専門家にご確認ください。
        </p>
      </SessionWorkspace>
    </main>
  );
}
