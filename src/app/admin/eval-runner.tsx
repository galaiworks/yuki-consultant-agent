"use client";

import { useState } from "react";
import { parseCases, type EvalCase } from "@/lib/evals/cases";

type Grade = { name: string; passed: boolean; reason: string };
type Result =
  | { id: string; ok: true; passed: boolean; grades: Grade[]; reply: string; citations: string[]; personaSource: string; seconds: number }
  | { id: string; ok: false; error: string };

/** 品質テスト。ケースのファイル(yuki-eval-cases.jsonl)を選ぶと、1 件ずつ本番と同じ YUKI で回答させて採点する */
export function EvalRunner() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(file: File) {
    setError(null);
    setResults([]);
    const { cases, errors } = parseCases(await file.text());
    if (errors.length || !cases.length) {
      setError(errors.length ? `ファイルを読めませんでした。${errors.slice(0, 3).join(" / ")}` : "ケースがありません");
      return;
    }
    for (const c of cases as EvalCase[]) {
      setRunning(`${c.id}(${results.length + 1}/${cases.length})`);
      try {
        const res = await fetch("/api/admin/evals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(c),
        });
        const j = await res.json();
        setResults((r) => [...r, res.ok ? { ...j, ok: true } : { id: c.id, ok: false, error: j.error ?? `失敗 (${res.status})` }]);
      } catch {
        setResults((r) => [...r, { id: c.id, ok: false, error: "通信に失敗しました" }]);
      }
    }
    setRunning(null);
  }

  const done = results.filter((r) => r.ok) as Extract<Result, { ok: true }>[];
  const passed = done.filter((r) => r.passed).length;

  return (
    <div className="card">
      <h2 style={{ fontSize: 18 }}>品質テスト</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        テストケースのファイル(yuki-eval-cases.jsonl)を選ぶと、本番と同じ YUKI に 1 件ずつ回答させて採点します。1 件 30〜90 秒、費用は 1 件あたり数十円が目安です。
      </p>
      <input
        type="file"
        accept=".jsonl,application/json,text/plain"
        disabled={Boolean(running)}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run(f);
          e.target.value = "";
        }}
      />
      {running && <p className="muted">実行中: {running}</p>}
      {error && <p className="error">{error}</p>}
      {results.length > 0 && (
        <>
          <p>
            <strong>合格 {passed} / {results.length} 件</strong>
            {done[0]?.personaSource === "provisional" && <span className="error"> (YUKI さんの判断軸が未登録のため、仮版で回答しています)</span>}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map((r) => (
              <details key={r.id} className="row-detail">
                <summary>
                  <span className="pill">{r.ok ? (r.passed ? "合格" : "不合格") : "エラー"}</span> {r.id}
                  {r.ok && <span className="muted"> ・{r.seconds} 秒</span>}
                </summary>
                {r.ok ? (
                  <>
                    <ul style={{ fontSize: 13 }}>
                      {r.grades.map((g) => (
                        <li key={g.name}>
                          {g.passed ? "○" : "×"} {g.name}: {g.reason}
                        </li>
                      ))}
                    </ul>
                    {r.citations.length > 0 && <p className="muted" style={{ fontSize: 13 }}>出典: {r.citations.join(" / ")}</p>}
                    <pre className="doc">{r.reply}</pre>
                  </>
                ) : (
                  <p className="error">{r.error}</p>
                )}
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
