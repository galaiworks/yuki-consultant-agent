"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { breakLongParagraphs } from "@/lib/text/wrap";
import type { ChatEvent } from "@/lib/agents/lead";
import { ConversationLog, ThinkingText, useUpdateSession } from "@/app/components/session-workspace";
import { silentWavUrl, useSpeechPlayer } from "@/app/components/use-speech-player";

type Citation = { title: string; source: string; cited_text: string };
export type InitialMessage = { id: string; role: "user" | "assistant"; text: string; citations: Citation[] };
/** dbId は保存後の ID(評価ボタンで使う)。表示用の id は変えない */
type Msg = InitialMessage & { pending?: boolean; dbId?: string };

/** 回答の「**太字**」を太字で表示する(それ以外の記法はそのまま文字で出す) */
function renderInline(text: string) {
  return text.split(/(\*\*[^*\n]+?\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** 出典の同一判定に使うキー。YouTube は動画 ID、ほかは URL そのもの */
function citationKey(c: Citation): string {
  try {
    const u = new URL(c.source);
    if (u.hostname === "youtu.be") return `yt:${u.pathname.slice(1)}`;
    if (u.hostname === "youtube.com" || u.hostname.endsWith(".youtube.com")) {
      // watch?v=ID・/embed/ID・/shorts/ID・/live/ID を同じ動画として扱う。動画 ID が取れなければ URL のまま
      const id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/)?.[1];
      return id ? `yt:${id}` : c.source;
    }
    // YouTube 以外は URL をそのまま使う(パラメータやハッシュで資料を見分けるサイトがあるため)
    return c.source;
  } catch {
    return c.source || c.title;
  }
}

/** 同じ動画を何か所も引用したときは、出典欄には 1 回だけ出す */
function uniqueCitations(items: Citation[]): Citation[] {
  const seen = new Set<string>();
  return items.filter((c) => {
    const key = citationKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  const [speechError, setSpeechError] = useState("");
  const [listen, setListen] = useState(true);
  const [stopKey, setStopKey] = useState(0);
  const speech = useSpeechPlayer();
  const updateSession = useUpdateSession();
  const request = useRef<AbortController | null>(null);
  const conversationId = useRef<string | null>(props.conversationId);
  useEffect(() => {
    try { setListen(localStorage.getItem("yuki.chat.speak") !== "off"); } catch { /* 保存できない端末では初期値を使う */ }
    return () => request.current?.abort();
  }, []);

  /** 読み上げの好みはこの端末にだけ保存する */
  function chooseListen(value: boolean) {
    setListen(value);
    try { localStorage.setItem("yuki.chat.speak", value ? "on" : "off"); } catch { /* この画面では選択を維持する */ }
    if (!value) speech.stop();
  }

  async function send(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy || props.disabled) return;
    setStopKey((key) => key + 1);
    if (listen && props.voiceEnabled) speech.begin();
    else speech.stop();
    setInput("");
    setError("");
    setStatus("");
    setSpeechError("");
    setBusy(true);
    const assistantId = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text, citations: [] },
      { id: assistantId, role: "assistant", text: "", citations: [], pending: true },
    ]);
    const patch = (fn: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.id === assistantId ? fn(m) : m)));
    const abort = new AbortController();
    request.current = abort;
    const refreshSession = () => {
      if (conversationId.current) updateSession({ id: conversationId.current, title: (props.initial.find((m) => m.role === "user")?.text ?? text).slice(0, 40), updated_at: new Date().toISOString() });
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId.current, message: text, speak: listen && props.voiceEnabled }),
        signal: abort.signal,
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
          const ev = JSON.parse(line) as ChatEvent;
          if (ev.type === "conversation") {
            if (!conversationId.current) window.history.replaceState(null, "", `/chat?c=${ev.id}`);
            conversationId.current = ev.id;
            refreshSession();
          } else if (ev.type === "text") {
            setStatus("");
            patch((m) => ({ ...m, text: m.text + ev.text }));
          } else if (ev.type === "status") {
            setStatus(`${ev.label}…`);
          } else if (ev.type === "audio") {
            speech.enqueue(ev.audio);
          } else if (ev.type === "speech_error") {
            setSpeechError(ev.message);
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
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "送信できませんでした");
    } finally {
      if (abort.signal.aborted) return;
      patch((m) => ({ ...m, pending: false }));
      refreshSession();
      setBusy(false);
      setStatus((s) => (s.startsWith("成果物") ? s : ""));
    }
  }

  return (
    <section className="chat session-client">
      <ConversationLog>
      {messages.length === 0 && (
        <div className="chat-welcome">
          <img className="welcome-portrait" src="/yuki/portrait.jpg" alt="YUKI" width={900} height={900} />
          <span className="eyebrow">Your next level starts here</span>
          <h2>どんなことでご相談しますか</h2>
          <p className="muted">例:「インスタを毎日投稿しているのに、半年たってもフォロワーが増えません。続けるべきですか?」</p>
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role}`}>
          {m.role === "assistant" && <img className="avatar message-avatar" src="/yuki/avatar.jpg" alt="" width={256} height={256} />}
          <div className="message-content">
            <span className="who">{m.role === "user" ? "あなた" : "YUKI(AI)"}</span>
            <div className="body">{m.text ? renderInline(m.role === "assistant" ? breakLongParagraphs(m.text) : m.text) : m.pending ? <ThinkingText status={status} /> : "返事を受け取れませんでした。もう一度お試しください。"}</div>
            {m.role === "assistant" && !m.pending && m.dbId && m.text && props.voiceEnabled && <Listen messageId={m.dbId} stopKey={stopKey} onPlay={speech.stop} />}
            {m.role === "assistant" && !m.pending && m.dbId && m.text && <Feedback messageId={m.dbId} />}
            {m.citations?.length > 0 && (
              <div className="cites">
                <span className="muted">出典</span>
                {uniqueCitations(m.citations).map((c, i) =>
                  c.source.startsWith("http") ? (
                    <a key={i} href={c.source} target="_blank" rel="noopener noreferrer">{c.title}</a>
                  ) : (
                    <span key={i}>{c.title}</span>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      ))}
      {status.startsWith("成果物") && <p className="status">{status}</p>}
      {error && <p className="error">{error}</p>}
      </ConversationLog>
      <div className="speech-controls row">
        {props.voiceEnabled && <label className="speech-toggle"><input type="checkbox" checked={listen} onChange={(e) => chooseListen(e.target.checked)} />声で聞く</label>}
        {speech.isPlaying && <button type="button" className="secondary" onClick={speech.stop}>■ 読み上げを止める</button>}
        {(speechError || speech.error) && <p className="error" role="status">{speechError || speech.error}</p>}
      </div>
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
        <div className="row composer-actions">
          <button className="send-button" type="submit" disabled={busy || props.disabled || !input.trim()}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
            <span className="sr-only">{busy ? "回答中…" : "送信"}</span>
          </button>
          <span className="muted" style={{ fontSize: 12 }}>Ctrl / ⌘ + Enter でも送信できます</span>
        </div>
      </form>
      <audio ref={speech.audio} preload="none" />
    </section>
  );
}

/**
 * YUKI の声で回答を聞く。一度作った音声はページを開いている間は使い回す。
 * Safari は「押してから時間がたった再生」を自動再生として止めるため、
 * 押した瞬間に無音を鳴らして <audio> を使える状態にしてから、届いた音声に差し替えて鳴らす。
 */
function Listen({ messageId, stopKey, onPlay }: { messageId: string; stopKey: number; onPlay: () => void }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [reason, setReason] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  // 音声を作っている間は、もう一度押しても 2 本目を頼まない(費用が二重にかかるため)
  const busy = useRef(false);
  // 画面から消えたら(別の相談に移ったら)、鳴らさない・止める・後始末する
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    audio.current?.pause();
    setState("idle");
  }, [stopKey]);
  useEffect(() => {
    mounted.current = true;
    const el = audio.current;
    return () => {
      mounted.current = false;
      el?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
    };
  }, []);

  async function toggle() {
    const el = audio.current;
    if (!el || busy.current) return;
    if (state === "playing") {
      el.pause();
      setState("idle");
      return;
    }
    setReason("");
    onPlay();
    const current = generation.current;
    try {
      if (!url.current) {
        busy.current = true;
        setState("loading");
        // 押した瞬間(await より前)に無音を再生しておく
        const silent = silentWavUrl();
        try {
          el.src = silent;
          void el.play().catch(() => {});
          const res = await fetch("/api/voice/speak", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ messageId }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? "読み上げできませんでした。少し時間をおいてお試しください");
          }
          const blob = await res.blob();
          if (!mounted.current || current !== generation.current) return;
          url.current = URL.createObjectURL(blob);
          el.src = url.current;
        } finally {
          URL.revokeObjectURL(silent);
          busy.current = false;
        }
      }
      if (!mounted.current || current !== generation.current) return;
      await el.play();
      if (mounted.current && current === generation.current) setState("playing");
    } catch (err) {
      if (!mounted.current || current !== generation.current) return;
      setState("error");
      setReason(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "ブラウザが再生を止めました。もう一度押してください"
          : err instanceof Error && err.message
            ? err.message
            : "読み上げできませんでした",
      );
    }
  }

  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" className="secondary" onClick={toggle} disabled={state === "loading"}>
        {state === "playing" ? "■ 止める" : state === "loading" ? "声を作っています…" : "▶ YUKI の声で聞く"}
      </button>
      {state === "error" && <span className="error" style={{ fontSize: 13 }}>{reason}</span>}
      <audio
        ref={audio}
        // 無音の終わりでは何もしない(本物の音声が終わったときだけ「聞く」に戻す)
        onEnded={(e) => {
          if (url.current && e.currentTarget.src === url.current) setState("idle");
        }}
        preload="none"
      />
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
