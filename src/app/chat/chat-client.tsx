"use client";

import { useRef, useState } from "react";

type Citation = { title: string; source: string; cited_text: string };
export type InitialMessage = { id: string; role: "user" | "assistant"; text: string; citations: Citation[] };
/** dbId は保存後の ID(評価ボタンで使う)。表示用の id は変えない */
type Msg = InitialMessage & { pending?: boolean; dbId?: string };

/** チャット画面。サーバーから 1 行 1 JSON のイベントを受け取って表示する */
export function ChatClient(props: {
  conversationId: string | null;
  initial: InitialMessage[];
  disabled: boolean;
  voiceEnabled: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>(props.initial.map((m) => ({ ...m, dbId: m.id })));
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
          } else if (ev.type === "saved") {
            patch((m) => ({ ...m, dbId: ev.id }));
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
          <p className="muted">例:「インスタを毎日投稿しているのに、半年たってもフォロワーが増えません。続けるべきですか?」</p>
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role}`}>
          <span className="who">{m.role === "user" ? "あなた" : "YUKI(AI)"}</span>
          <div className="body">{m.text || (m.pending ? "考えています…" : "")}</div>
          {m.role === "assistant" && !m.pending && m.dbId && m.text && props.voiceEnabled && <Listen messageId={m.dbId} />}
          {m.role === "assistant" && !m.pending && m.dbId && m.text && <Feedback messageId={m.dbId} />}
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

/** YUKI の声で回答を聞く。一度作った音声はページを開いている間は使い回す */
function Listen({ messageId }: { messageId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  async function toggle() {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    if (!audio.current) return;
    try {
      if (!url.current) {
        setState("loading");
        // iPhone では、押した直後に再生を始めないと音が出ないことがあるので、先に鳴らす準備をしておく
        void audio.current.play().catch(() => {});
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageId }),
        });
        if (!res.ok) throw new Error();
        url.current = URL.createObjectURL(await res.blob());
        audio.current.src = url.current;
      }
      await audio.current.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" className="secondary" onClick={toggle} disabled={state === "loading"}>
        {state === "playing" ? "■ 止める" : state === "loading" ? "声を作っています…" : "▶ YUKI の声で聞く"}
      </button>
      {state === "error" && <span className="error" style={{ fontSize: 13 }}>読み上げできませんでした</span>}
      <audio ref={audio} onEnded={() => setState("idle")} preload="none" />
    </div>
  );
}

/** 回答への 👍/👎。コメントは次回以降の回答に反映される */
function Feedback({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(r: 1 | -1, text?: string) {
    setRating(r);
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId, rating: r, comment: text || undefined }),
    }).catch(() => undefined);
    if (text) setSent(true);
  }

  if (sent) return <p className="feedback muted">ありがとうございます。次回からの回答に反映します。</p>;
  return (
    <div className="feedback">
      <span className="muted">この回答は役に立ちましたか?</span>
      <button type="button" className="secondary" aria-pressed={rating === 1} onClick={() => submit(1)}>👍</button>
      <button type="button" className="secondary" aria-pressed={rating === -1} onClick={() => submit(-1)}>👎</button>
      {rating !== null && (
        <>
          <input
            aria-label="ひとことコメント"
            placeholder={rating === 1 ? "良かった点(任意)" : "どこを直してほしいか(任意)"}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ flex: "1 1 200px", padding: "4px 8px" }}
          />
          <button type="button" onClick={() => submit(rating, comment.trim())} disabled={!comment.trim()}>送る</button>
        </>
      )}
    </div>
  );
}
