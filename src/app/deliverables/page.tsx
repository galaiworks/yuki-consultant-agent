import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Nav } from "@/app/nav";

const KIND_LABEL: Record<string, string> = {
  diagnosis_report: "経営診断レポート",
  action_plan: "90日アクションプラン",
  business_plan: "事業計画書",
  other: "成果物",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "受付済み",
  running: "作成中",
  needs_review: "担当者の確認待ち",
  approved: "完成",
  escalated: "担当者が確認中",
  failed: "作成に失敗",
};

export default async function DeliverablesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("deliverables")
    .select("id, kind, status, content_md, final_score, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="shell">
      <Nav />
      <h1>成果物</h1>
      <p className="muted">レポートや計画書は、品質チェック(95 点基準)に合格してから表示されます。作成には数分かかります。</p>
      {(data ?? []).length === 0 && <div className="card">まだありません。相談の中で「レポートにして」と頼むと作成されます。</div>}
      {(data ?? []).map((d) => (
        <article key={d.id} className="card">
          <div className="row">
            <h2 style={{ fontSize: 18 }}>{KIND_LABEL[d.kind] ?? "成果物"}</h2>
            <span className={`pill ${d.status === "approved" ? "ok" : ""}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
            <span className="muted" style={{ fontSize: 12 }}>{new Date(d.created_at).toLocaleString("ja-JP")}</span>
          </div>
          {d.status === "approved" && d.content_md ? (
            <pre className="doc">{d.content_md}</pre>
          ) : (
            <p className="muted">完成までお待ちください。</p>
          )}
        </article>
      ))}
    </main>
  );
}
