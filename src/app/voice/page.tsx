import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAccessForCurrentUser } from "@/lib/access";
import { appConfig } from "@/lib/config";
import { Nav } from "@/app/nav";
import { VoiceClient } from "@/app/voice/voice-client";

export default async function VoicePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getAccessForCurrentUser(supabase, user);
  if (!access.allowed && access.reason === "no_subscription") redirect("/redeem");

  return (
    <main className="shell">
      <Nav />
      <h1>YUKI と声で話す</h1>
      {!appConfig.voiceEnabled && <p className="notice">音声の会話は準備中です。もうしばらくお待ちください。</p>}
      {!access.allowed && <p className="error">今月の利用上限に達しました。来月またはプラン変更後にご利用ください。</p>}
      <VoiceClient disabled={!access.allowed || !appConfig.voiceEnabled} />
      <p className="notice">
        この YUKI は、YUKI 本人の動画と考え方をもとに作られた AI です(本人公認)。本人がその場で話しているわけではありません。法務・税務・投資・医療の判断は専門家にご確認ください。
      </p>
    </main>
  );
}
