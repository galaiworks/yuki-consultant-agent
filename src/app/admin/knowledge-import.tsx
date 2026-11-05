"use client";

import { useState } from "react";
import { parseBundle } from "@/lib/knowledge/bundle";

type Progress = { done: number; total: number; failed: string[]; note?: string };

async function post(body: unknown): Promise<{ ok?: boolean; error?: string; [k: string]: unknown }> {
  const res = await fetch("/api/admin/knowledge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ error: `通信に失敗しました (${res.status})` }));
}

/** 取り込みファイル(yuki-knowledge-bundle.jsonl)を選ぶと、判断軸と動画を 1 本ずつ送る */
export function KnowledgeImport() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearTest, setClearTest] = useState(true);

  async function run(file: File) {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const { persona, videos, errors } = parseBundle(await file.text());
      if (errors.length) {
        setError(`ファイルを読めませんでした。${errors.slice(0, 3).join(" / ")}`);
        return;
      }
      if (!persona.length && !videos.length) {
        setError("取り込めるデータがありませんでした");
        return;
      }
      const failed: string[] = [];
      if (persona.length) {
        const r = await post({ action: "persona", items: persona });
        if (r.error) failed.push(`判断軸: ${r.error}`);
      }
      let done = 0;
      setProgress({ done, total: videos.length, failed });
      for (const v of videos) {
        const r = await post({ action: "video", item: v });
        if (r.error) failed.push(`${v.title}: ${r.error}`);
        done += 1;
        setProgress({ done, total: videos.length, failed: [...failed] });
      }
      let note = `判断軸 ${persona.length} 層、動画 ${videos.length - failed.filter((f) => !f.startsWith("判断軸")).length} 本を登録しました。`;
      if (clearTest && failed.length === 0) {
        const r = await post({ action: "clear_test" });
        note += r.error ? ` テスト用サンプルの削除に失敗: ${r.error}` : ` テスト用サンプルを ${r.deleted ?? 0} 件削除しました。`;
      }
      setProgress({ done, total: videos.length, failed, note });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 18 }}>YUKI さんのデータを取り込む</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        取り込みファイル(yuki-knowledge-bundle.jsonl)を選んでください。判断軸(5 つの層)と動画の逐語録を登録します。
        同じファイルをもう一度選ぶと、上書きで入れ直します。
      </p>
      <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={clearTest} onChange={(e) => setClearTest(e.target.checked)} style={{ width: "auto" }} />
        成功したらテスト用サンプルを削除する
      </label>
      <input
        type="file"
        accept=".jsonl,application/json,text/plain"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(f);
          e.target.value = "";
        }}
      />
      {busy && progress && <p className="muted">送信中… {progress.done} / {progress.total} 本</p>}
      {busy && !progress && <p className="muted">ファイルを読んでいます…</p>}
      {error && <p className="error">{error}</p>}
      {progress?.note && <p className="notice">{progress.note}</p>}
      {progress && progress.failed.length > 0 && (
        <details>
          <summary className="error">失敗 {progress.failed.length} 件(もう一度同じファイルを選べば入れ直せます)</summary>
          <ul style={{ fontSize: 13 }}>
            {progress.failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
