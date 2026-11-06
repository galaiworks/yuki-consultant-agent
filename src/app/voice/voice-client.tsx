"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Line = { who: "you" | "yuki"; text: string };

/** 0.1 秒の無音。iPhone で音を鳴らせる状態にするために、ボタンを押したときに一度だけ再生する */
const SILENT_WAV = "data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
type Phase = "idle" | "recording" | "thinking" | "speaking";

/** ブラウザが録音できる形式を選ぶ(iPhone の Safari は mp4) */
function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

const LABEL: Record<Phase, string> = {
  idle: "ボタンを押してから話し、話し終わったらもう一度押してください",
  recording: "聞いています…話し終わったらボタンを押してください",
  thinking: "YUKI が考えています…",
  speaking: "YUKI が話しています",
};

export function VoiceClient({ disabled }: { disabled: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const player = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const send = useCallback(async (blob: Blob, durationSec: number) => {
    setPhase("thinking");
    const form = new FormData();
    form.append("audio", blob, "voice");
    form.append("durationSec", String(Math.round(durationSec)));
    if (conversationId.current) form.append("conversationId", conversationId.current);
    try {
      const res = await fetch("/api/voice/turn", { method: "POST", body: form });
      const data = (await res.json()) as {
        conversationId?: string;
        userText?: string;
        replyText?: string;
        audio?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "うまくいきませんでした");
      conversationId.current = data.conversationId ?? conversationId.current;
      setLines((prev) => [...prev, { who: "you", text: data.userText ?? "" }, { who: "yuki", text: data.replyText ?? "" }]);
      if (data.audio && player.current) {
        player.current.src = `data:audio/mpeg;base64,${data.audio}`;
        setPhase("speaking");
        await player.current.play().catch(() => setPhase("idle"));
      } else {
        setPhase("idle");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }, []);

  const toggle = useCallback(async () => {
    setError(null);
    if (phase === "recording") {
      recorder.current?.stop();
      return;
    }
    if (phase !== "idle") return;
    try {
      // iPhone では、ボタンを押した瞬間に一度音を鳴らしておかないと、あとで再生できない。
      // 終わるのを待つと録音の開始が止まることがあるので、待たずに先へ進む
      if (player.current) {
        player.current.src = SILENT_WAV;
        void player.current.play().catch(() => {});
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
        void send(blob, (Date.now() - startedAt.current) / 1000);
      };
      recorder.current = rec;
      rec.start();
      startedAt.current = Date.now();
      setPhase("recording");
    } catch {
      setError("マイクを使えませんでした。ブラウザでマイクの使用を許可してください");
      setPhase("idle");
    }
  }, [phase, send]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={toggle}
          disabled={disabled || phase === "thinking" || phase === "speaking"}
          aria-pressed={phase === "recording"}
        >
          {phase === "recording" ? "話し終わった" : "話す"}
        </button>
        <span className="muted" aria-live="polite">{LABEL[phase]}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {lines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lines.map((l, i) => (
            <p key={i} className={l.who === "yuki" ? "" : "muted"} style={{ margin: 0 }}>
              <strong>{l.who === "yuki" ? "YUKI(AI)" : "あなた"}:</strong> {l.text}
            </p>
          ))}
        </div>
      )}
      <audio
        ref={player}
        onEnded={() => setPhase((p) => (p === "speaking" ? "idle" : p))}
        onError={() => setPhase((p) => (p === "speaking" ? "idle" : p))}
        preload="none"
      />
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        1 回に話すのは 1 分くらいまでがおすすめです。会話は文字の相談と同じく履歴に残ります。
      </p>
    </section>
  );
}
