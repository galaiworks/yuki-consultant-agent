import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig } from "@/lib/config";
import { Nav } from "@/app/nav";
import { ChatClient, type InitialMessage } from "@/app/chat/chat-client";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getAccessForCurrentUser(supabase, user);
  if (!access.allowed && access.reason === "no_subscription") redirect("/redeem");

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(10);

  let initial: InitialMessage[] = [];
  if (c) {
    const { data } = await supabase
      .from("messages")
      .select("id, role, text, citations")
      .eq("conversation_id", c)
      .order("created_at");
    initial = (data ?? []) as InitialMessage[];
  }

  return (
    <main className="shell">
      <Nav />
      <div className="convs">
        <Link href="/chat">+ 新しい相談</Link>
        {(conversations ?? []).map((conv) => (
          <Link key={conv.id} href={`/chat?c=${conv.id}`} className="pill">{conv.title ?? "相談"}</Link>
        ))}
      </div>
      {!access.allowed && <p className="error">今月の利用上限に達しました。来月またはプラン変更後にご利用ください。</p>}
      <ChatClient key={c ?? "new"} conversationId={c ?? null} initial={initial} disabled={!access.allowed} voiceEnabled={appConfig.voiceEnabled} />
      <p className="notice">この YUKI は、YUKI 本人の動画と考え方をもとに作られた AI です(本人公認)。本人がその場で答えているわけではありません。法務・税務・投資・医療の判断は専門家にご確認ください。</p>
    </main>
  );
}
