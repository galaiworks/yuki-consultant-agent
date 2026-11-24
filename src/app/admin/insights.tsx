"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewInsightAction, type InsightReviewState } from "@/app/admin/insights-actions";
import type { InsightTopic } from "@/lib/insights/privacy";
import type { InsightRunResult } from "@/lib/insights/extract";

const STATUS = { draft: "下書き", approved: "承認済みナレッジ", rejected: "却下" };

/** 本文・利用者識別情報を持たず、傾向だけを人が確認する。 */
function Review({ topic }: { topic: InsightTopic }) {
  const [state, action, pending] = useActionState<InsightReviewState, FormData>(reviewInsightAction, {});
  return (
    <article className="row-detail">
      <div className="row"><h3>{topic.theme}</h3><span className="pill">{STATUS[topic.status]}</span></div>
      <p>{topic.pattern}</p>
      <p className="muted">{topic.category} ・ {topic.user_count} 人 ・ {topic.video_gap ? "動画で未回答（制作候補）" : "関連する動画の回答あり"}</p>
      <form action={action} className="row">
        <input type="hidden" name="id" value={topic.id} />
        <button name="status" value="approved" type="submit" disabled={pending || topic.status === "approved"}>承認</button>
        <button name="status" value="rejected" type="submit" className="secondary" disabled={pending || topic.status === "rejected"}>却下</button>
      </form>
      <div aria-live="polite">{state.error ? <p className="error">{state.error}</p> : state.ok && <p>{state.ok}</p>}</div>
    </article>
  );
}

/** 上限つきの手動実行と匿名の一覧。承認済みでも利用者への回答には接続しない。 */
export function InsightsPanel({ topics, unavailable = false }: { topics: InsightTopic[]; unavailable?: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run() {
    setRunning(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/insights", { method: "POST" });
      const data = await response.json() as InsightRunResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "処理を開始できませんでした。");
      setMessage(`${data.processed} 会話の傾向を保存、${data.skipped} 会話は対象外でした。${data.stopped === "limit" ? "今回の処理上限です。続きは再度ボタンを押してください。" : ""}`);
      if (data.stopped === "failed") setError("処理中に問題が起きたため停止しました。設定を確認してください。保存済みの分は残っています。");
      router.refresh();
    } catch { setError("傾向をまとめられませんでした。設定・通信を確認してから再実行してください。"); }
    finally { setRunning(false); }
  }

  return (
    <section className="card" aria-labelledby="insights-heading">
      <h2 id="insights-heading" style={{ fontSize: 18 }}>相談の傾向</h2>
      <p className="muted" style={{ fontSize: 13 }}>同意のある相談だけを一般化し、異なる利用者から5人以上集まったテーマを表示します。承認済みだけが改善用のナレッジになります。別の利用者への回答には使いません。</p>
      <p className="notice">承認前に、個人の推測につながる内容がないか、悩みの型と動画の判定が妥当か確認してください。書き出した資料は最新版に差し替え、同意取り消しで一覧から外れた傾向は利用を停止してください。</p>
      <div className="row">
        <button onClick={() => void run()} disabled={running || unavailable}>{running ? "まとめています…" : "相談の傾向をまとめる"}</button>
        {!unavailable && <a href="/api/admin/insights/export">承認済みを Markdown で書き出す</a>}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>1回で最大10会話を処理します。AIの利用料は運営の費用として記録します。</p>
      <div aria-live="polite">{message && <p>{message}</p>}{error && <p className="error">{error}</p>}</div>
      {unavailable ? <p className="error">傾向のデータを読み込めませんでした。マイグレーションの適用状況を確認してください。</p>
        : topics.length ? topics.map((topic) => <Review key={topic.id} topic={topic} />) : <p className="muted">5人以上から集まった傾向はまだありません。</p>}
    </section>
  );
}
