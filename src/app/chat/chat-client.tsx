"use client";

import { useRef, useState } from "react";

type Citation = { title: string; source: string; cited_text: string };
export type InitialMessage = { id: string; role: "user" | "assistant"; text: string; citations: Citation[] };
type Msg = InitialMessage & { pending?: boolean };

/** チャット画面。サーバーから 1 行 1 JSON のイベントを受け取って表示する */
export function ChatClient(props: { conversationId: string | null; initial: InitialMessage[]; disabled: boolean }) {
  const [messages, setMessages] = useState<Msg[]>(props.initial);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conversationId = useRef<string | null>(props.conversationId);

  async function send(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError("");
    setBusy(true);
    const assistantId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text, citations: [] },
      { id: assistantId, role: "assistant", text: "", citations: [], pending: true },
    ]);
    const patch = (fn: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.id === assistantId ? fn(m) : m)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId.current, message: text }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "送信できませんでした");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "conversation") {
            if (!conversationId.current) window.history.replaceState(null, "", `/chat?c=${ev.id}`);
            conversationId.current = ev.id;
          } else if (ev.type === "text") {
            setStatus("");
            patch((m) => ({ ...m, text: m.text + ev.text }));
          } else if (ev.type === "status") {
            setStatus(`${ev.label}…`);
          } else if (ev.type === "citations") {
            patch((m) => ({ ...m, citations: ev.items }));
          } else if (ev.type === "deliverable") {
            setStatus("成果物の作成を受け付けました。「成果物」ページで確認できます。");
          } else if (ev.type === "error") {
            setError(ev.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信できませんでした");
    } finally {
      patch((m) => ({ ...m, pending: false }));
      setBusy(false);
      setStatus((s) => (s.startsWith("成果物") ? s : ""));
    }
  }

  return (
    <section className="chat" aria-live="polite">
      {messages.length === 0 && (
        <div className="card">
          <h2>どんなことでご相談しますか</h2>
          <p className="muted">例:「日本で売れている自社商品を米国で試したい。最初の 90 日で何をすべき?」</p>
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role}`}>
          <span className="who">{m.role === "user" ? "あなた" : "YUKI Consultant Agent(AI)"}</span>
          <div className="body">{m.text || (m.pending ? "考えています…" : "")}</div>
          {m.citations?.length > 0 && (
            <div className="cites">
              <span className="muted">出典</span>
              {m.citations.map((c, i) =>
                c.source.startsWith("http") ? (
                  <a key={i} href={c.source} target="_blank" rel="noopener noreferrer">{c.title}</a>
                ) : (
                  <span key={i}>{c.title}</span>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      {status && <p className="status">{status}</p>}
      {error && <p className="error">{error}</p>}
      <form className="composer" onSubmit={send}>
        <label htmlFor="message" className="muted" style={{ fontWeight: 400 }}>
          相談内容
          <textarea
            id="message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
            }}
            disabled={props.disabled}
            placeholder="状況と、決めたいことを書いてください"
          />
        </label>
        <div className="row">
          <button type="submit" disabled={busy || props.disabled || !input.trim()}>{busy ? "回答中…" : "送信"}</button>
          <span className="muted" style={{ fontSize: 12 }}>Ctrl / ⌘ + Enter でも送信できます</span>
        </div>
      </form>
    </section>
  );
}
