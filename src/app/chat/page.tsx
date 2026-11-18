import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig } from "@/lib/config";
import { Nav } from "@/app/nav";
import { ChatClient, type InitialMessage } from "@/app/chat/chat-client";
import { SessionWorkspace } from "@/app/components/session-workspace";
import { SESSION_PAGE_SIZE, type Conversation } from "@/lib/ui/sessions";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getAccessForCurrentUser(supabase, user);
  if (!access.allowed && access.reason === "no_subscription") redirect("/redeem");

  const { data: conversations, error: listError } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SESSION_PAGE_SIZE + 1);

  let initial: InitialMessage[] = [];
  let activeConversation: Conversation | null = null;
  if (c) {
    const { data: conversation } = await supabase.from("conversations").select("id, title, updated_at").eq("id", c).maybeSingle();
    if (!conversation) redirect("/chat");
    activeConversation = conversation;
    const { data } = await supabase
      .from("messages")
      .select("id, role, text, citations")
      .eq("conversation_id", c)
      .order("created_at");
    initial = (data ?? []) as InitialMessage[];
  }

  return (
    <main className="shell chat-page session-page">
      <Nav />
      <SessionWorkspace key={c ?? "new"} initial={conversations ?? []} activeId={c ?? null} activeConversation={activeConversation} mode="chat">
        {listError && <p className="error">会話一覧を読み込めませんでした。ページを再読み込みしてください。</p>}
        {!access.allowed && <p className="error">今月の利用上限に達しました。来月またはプラン変更後にご利用ください。</p>}
        <ChatClient key={c ?? "new"} conversationId={c ?? null} initial={initial} disabled={!access.allowed} voiceEnabled={appConfig.voiceEnabled} />
        <p className="notice">この YUKI は、YUKI 本人の動画と考え方をもとに作られた AI です(本人公認)。本人がその場で答えているわけではありません。法務・税務・投資・医療の判断は専門家にご確認ください。</p>
      </SessionWorkspace>
    </main>
  );
}
