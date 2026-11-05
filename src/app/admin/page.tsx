import { requireAdmin } from "@/lib/admin/guard";
import { appConfig } from "@/lib/config";
import { Nav } from "@/app/nav";
import { CreateClientForm, CreatePassForm, ResetPasswordButton } from "@/app/admin/forms";
import { approveDeliverableAction } from "@/app/admin/actions";
import { KnowledgeImport } from "@/app/admin/knowledge-import";

const STATUS_LABEL: Record<string, string> = {
  queued: "受付済み",
  running: "作成中",
  needs_review: "確認待ち",
  approved: "完成",
  escalated: "要確認(95点未達など)",
  failed: "失敗",
};

const usd = (n: number) => `$${n.toFixed(2)}`;

type AdminClient = Awaited<ReturnType<typeof requireAdmin>>["admin"];

/** 今月の利用記録を全件読む(API の 1 回あたりの行数上限を超えても漏らさない) */
async function fetchMonthlyUsage(admin: AdminClient, since: Date) {
  const pageSize = 1000;
  const rows: { user_id: string; cost_usd: number }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("usage_logs")
      .select("user_id, cost_usd")
      .gte("created_at", since.toISOString())
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`利用記録を読めませんでした: ${error.message}`);
    rows.push(...((data ?? []) as { user_id: string; cost_usd: number }[]));
    if (!data || data.length < pageSize) return rows;
  }
}

export default async function AdminPage() {
  const { admin } = await requireAdmin();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [kSources, kChunks, kTest, personaRows] = await Promise.all([
    admin.from("knowledge_sources").select("id", { count: "exact", head: true }).eq("is_test", false),
    admin.from("knowledge_chunks").select("id", { count: "exact", head: true }),
    admin.from("knowledge_sources").select("id", { count: "exact", head: true }).eq("is_test", true),
    // 判断軸の表はマイグレーション適用後に使える
    admin.from("persona_layers").select("key, version, updated_at"),
  ]);

  const [profiles, subs, usageRows, plans, passes, deliverables, pending, feedback] = await Promise.all([
    admin.from("profiles").select("id, email, display_name, company_name, role, created_at").order("created_at", { ascending: false }),
    admin.from("subscriptions").select("user_id, plan_id, source, status, current_period_end"),
    fetchMonthlyUsage(admin, monthStart),
    admin.from("plans").select("id, name, monthly_usage_limit_usd").eq("is_active", true),
    admin
      .from("access_passes")
      .select("id, label, plan_id, duration_days, max_redemptions, redemption_count, expires_at, revoked_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("deliverables")
      .select("id, user_id, kind, brief, status, final_score, attempts, error, content_md, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    // 要確認の成果物は最近の一覧とは別に取る(古いものが一覧から漏れないように)
    admin
      .from("deliverables")
      .select("id, user_id, kind, brief, status, final_score, attempts, error, content_md, created_at")
      .in("status", ["needs_review", "escalated", "failed"])
      .order("created_at", { ascending: true })
      .limit(200),
    // 評価ボタンのテーブルはマイグレーション適用後に使える。無ければ空として扱う
    admin.from("message_feedback").select("rating, comment, created_at, user_id").order("created_at", { ascending: false }).limit(20),
  ]);

  const usageByUser = new Map<string, number>();
  for (const u of usageRows) {
    usageByUser.set(u.user_id, (usageByUser.get(u.user_id) ?? 0) + Number(u.cost_usd));
  }
  const totalCost = [...usageByUser.values()].reduce((n, v) => n + v, 0);
  // 表示するメールは、本人が書き換えられない認証済みのメールを優先する
  const authUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authEmail = new Map((authUsers.data?.users ?? []).map((u) => [u.id, u.email ?? ""]));
  const emailOf = new Map((profiles.data ?? []).map((p) => [p.id, authEmail.get(p.id) || (p.email as string)]));
  const attention = pending.data ?? [];
  const feedbackRows = feedback.error ? [] : (feedback.data ?? []);
  const good = feedbackRows.filter((f) => f.rating === 1).length;
  const now = new Date();

  return (
    <main className="shell" style={{ maxWidth: 1040 }}>
      <Nav />
      <h1>管理</h1>

      <section className="stats">
        <div className="stat"><span className="muted">登録者</span><strong>{profiles.data?.length ?? 0}</strong></div>
        <div className="stat"><span className="muted">今月の API 費用</span><strong>{usd(totalCost)}</strong></div>
        <div className="stat"><span className="muted">要確認の成果物</span><strong>{attention.length}</strong></div>
        <div className="stat">
          <span className="muted">回答の評価(直近)</span>
          <strong>{feedbackRows.length ? `👍 ${good} / 👎 ${feedbackRows.length - good}` : "-"}</strong>
        </div>
        <div className="stat">
          <span className="muted">YUKI さんのデータ</span>
          <strong>
            {personaRows.error ? "未設定" : `判断軸 ${personaRows.data?.length ?? 0}/7 層`} / 動画 {kSources.count ?? 0} 本
          </strong>
          <span className="muted" style={{ fontSize: 12 }}>
            チャンク {kChunks.count ?? 0} 件{(kTest.count ?? 0) > 0 ? ` / テスト用サンプル ${kTest.count} 件が残っています` : ""}
          </span>
        </div>
        <div className="stat"><span className="muted">利用モード</span><strong>{appConfig.accessMode === "open" ? "無料(テスト)" : "有料"}</strong></div>
      </section>

      {attention.length > 0 && (
        <section className="card">
          <h2 style={{ fontSize: 18 }}>確認が必要な成果物</h2>
          {attention.map((d) => (
            <details key={d.id} className="row-detail">
              <summary>
                <span className="pill">{STATUS_LABEL[d.status]}</span> {emailOf.get(d.user_id)} / {d.kind} / {d.final_score ?? "-"} 点
              </summary>
              <p className="muted" style={{ fontSize: 13 }}>依頼: {d.brief}</p>
              {d.error && <p className="error" style={{ fontSize: 13 }}>{d.error}</p>}
              {d.content_md && <pre className="doc">{d.content_md}</pre>}
              {d.content_md && d.status !== "failed" && (
                <form action={approveDeliverableAction}>
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit">内容を確認したので相談者に公開する</button>
                </form>
              )}
            </details>
          ))}
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: 18 }}>登録者</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>メール</th><th>名前 / 会社</th><th>権限</th><th>利用権</th><th>今月の費用</th><th></th></tr>
            </thead>
            <tbody>
              {(profiles.data ?? []).map((p) => {
                const active = (subs.data ?? []).filter(
                  (s) =>
                    s.user_id === p.id &&
                    (s.status === "active" || s.status === "trialing") &&
                    (!s.current_period_end || new Date(s.current_period_end) > now),
                );
                return (
                  <tr key={p.id}>
                    <td>{emailOf.get(p.id)}</td>
                    <td>{[p.display_name, p.company_name].filter(Boolean).join(" / ") || "-"}</td>
                    <td>{p.role === "admin" ? "管理者" : "クライアント"}</td>
                    <td>
                      {active.length
                        ? active
                            .map(
                              (s) =>
                                `${s.plan_id}(${s.source === "access_pass" ? "チケット" : s.source}${
                                  s.current_period_end ? `・${new Date(s.current_period_end).toLocaleDateString("ja-JP")}まで` : ""
                                })`,
                            )
                            .join(", ")
                        : appConfig.accessMode === "open"
                          ? `${appConfig.defaultPlanId}(テスト期間)`
                          : "なし"}
                    </td>
                    <td className="num">{usd(usageByUser.get(p.id) ?? 0)}</td>
                    <td><ResetPasswordButton userId={p.id} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {personaRows.error && (
        <p className="error">
          判断軸の表がまだありません。Supabase で supabase/migrations/20261104000200_private_knowledge_and_persona.sql を実行してください。
        </p>
      )}
      <KnowledgeImport />

      <div className="grid2">
        <CreateClientForm siteUrl={appConfig.siteUrl} />
        <CreatePassForm
          plans={(plans.data ?? []).map((p) => ({ id: p.id, name: `${p.name}(月 ${usd(Number(p.monthly_usage_limit_usd))} まで)` }))}
        />
      </div>

      {feedbackRows.some((f) => f.comment) && (
        <section className="card">
          <h2 style={{ fontSize: 18 }}>回答へのコメント</h2>
          {feedbackRows
            .filter((f) => f.comment)
            .map((f, i) => (
              <p key={i} style={{ fontSize: 14 }}>
                {f.rating === 1 ? "👍" : "👎"} {f.comment} <span className="muted">({emailOf.get(f.user_id)})</span>
              </p>
            ))}
        </section>
      )}

      <section className="card">
        <h2 style={{ fontSize: 18 }}>発行済みチケット</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>メモ</th><th>プラン</th><th>日数</th><th>利用</th><th>発行日</th></tr></thead>
            <tbody>
              {(passes.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.label ?? "-"}{p.revoked_at ? "(無効)" : ""}</td>
                  <td>{p.plan_id}</td>
                  <td className="num">{p.duration_days}</td>
                  <td className="num">{p.redemption_count} / {p.max_redemptions}</td>
                  <td>{new Date(p.created_at).toLocaleDateString("ja-JP")}</td>
                </tr>
              ))}
              {(passes.data ?? []).length === 0 && <tr><td colSpan={5} className="muted">まだありません</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: 18 }}>最近の成果物</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>依頼者</th><th>種類</th><th>状態</th><th>点数</th><th>日時</th></tr></thead>
            <tbody>
              {(deliverables.data ?? []).map((d) => (
                <tr key={d.id}>
                  <td>{emailOf.get(d.user_id)}</td>
                  <td>{d.kind}</td>
                  <td>{STATUS_LABEL[d.status] ?? d.status}</td>
                  <td className="num">{d.final_score ?? "-"}</td>
                  <td>{new Date(d.created_at).toLocaleString("ja-JP")}</td>
                </tr>
              ))}
              {(deliverables.data ?? []).length === 0 && <tr><td colSpan={5} className="muted">まだありません</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
