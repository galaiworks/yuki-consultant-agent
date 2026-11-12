"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceEvent } from "@/lib/voice/sentences";

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

/** 話し終わったとみなす無音の長さ(ミリ秒)と、1 回の録音の上限 */
const SILENCE_MS = 1200;
const MAX_RECORD_MS = 90_000;
/** これより大きい音を「話している」とみなす(0〜1 の音量) */
const VOICE_LEVEL = 0.02;

/**
 * 録音中の音量を見て、話し終わって少し黙ったら onSilence を呼ぶ。
 * 一度も話し声が聞こえないうちは止めない。止めるための関数を返す。
 * ブラウザが音量を取れないとき(古い iPhone など)は何もしない(ボタンで止められる)。
 */
function watchSilence(stream: MediaStream, onSilence: () => void): () => void {
  let ctx: AudioContext;
  let analyser: AnalyserNode;
  try {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
  } catch {
    return () => {};
  }
  void ctx.resume().catch(() => {});
  const data = new Float32Array(analyser.fftSize);
  const started = Date.now();
  let heard = false;
  let lastVoice = Date.now();
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const level = Math.sqrt(sum / data.length);
    const now = Date.now();
    if (level > VOICE_LEVEL) {
      heard = true;
      lastVoice = now;
    }
    if ((heard && now - lastVoice > SILENCE_MS) || now - started > MAX_RECORD_MS) {
      stop();
      onSilence();
    }
  }, 100);
  function stop() {
    clearInterval(timer);
    void ctx.close().catch(() => {});
  }
  return stop;
}

const LABEL: Record<Phase, string> = {
  idle: "ボタンを押して話してください。話し終わって少し黙ると、自動で YUKI に届きます",
  recording: "聞いています…話し終わったら少し黙るか、ボタンを押してください",
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
  const stopWatch = useRef<() => void>(() => {});
  // 文ごとに届く YUKI の声を、届いた順に 1 つずつ再生する
  const queue = useRef<string[]>([]);
  const playing = useRef(false);
  const replyDone = useRef(true);
  const sentAt = useRef(0);
  const [waitSec, setWaitSec] = useState<number | null>(null);

  const playNext = useCallback(() => {
    const el = player.current;
    const next = queue.current.shift();
    if (!el || !next) {
      playing.current = false;
      if (replyDone.current) setPhase((p) => (p === "speaking" || p === "thinking" ? "idle" : p));
      return;
    }
    playing.current = true;
    if (sentAt.current) {
      setWaitSec((Date.now() - sentAt.current) / 1000);
      sentAt.current = 0;
    }
    setPhase("speaking");
    el.src = `data:audio/mpeg;base64,${next}`;
    el.play().catch(() => playNext());
  }, []);

  useEffect(
    () => () => {
      stopWatch.current();
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const send = useCallback(
    async (blob: Blob, durationSec: number) => {
      setPhase("thinking");
      setWaitSec(null);
      sentAt.current = Date.now();
      queue.current = [];
      replyDone.current = false;
      const form = new FormData();
      form.append("audio", blob, "voice");
      form.append("durationSec", String(Math.round(durationSec)));
      if (conversationId.current) form.append("conversationId", conversationId.current);
      try {
        const res = await fetch("/api/voice/turn", { method: "POST", body: form });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "うまくいきませんでした");
        }
        // 1 行 1 JSON で、文字と声が文ごとに届く
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let yukiLine = -1;
        const handle = (event: VoiceEvent) => {
          if (event.type === "heard") {
            conversationId.current = event.conversationId;
            setLines((prev) => {
              yukiLine = prev.length + 1;
              return [...prev, { who: "you", text: event.userText }, { who: "yuki", text: "" }];
            });
          } else if (event.type === "text") {
            setLines((prev) => prev.map((l, i) => (i === yukiLine ? { ...l, text: l.text + event.text } : l)));
          } else if (event.type === "audio") {
            queue.current.push(event.audio);
            if (!playing.current) playNext();
          } else if (event.type === "error") {
            setError(event.error);
          }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) handle(JSON.parse(line) as VoiceEvent);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        replyDone.current = true;
        if (!playing.current) setPhase("idle");
      }
    },
    [playNext],
  );

  const toggle = useCallback(async () => {
    setError(null);
    if (phase === "recording") {
      stopWatch.current();
      if (recorder.current?.state === "recording") recorder.current.stop();
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
        stopWatch.current();
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
        void send(blob, (Date.now() - startedAt.current) / 1000);
      };
      recorder.current = rec;
      rec.start();
      startedAt.current = Date.now();
      // 話し終わって少し黙ったら、ボタンを押さなくても送る
      stopWatch.current = watchSilence(stream, () => {
        if (rec.state === "recording") rec.stop();
      });
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
      {waitSec !== null && (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          話し終わってから YUKI の声が出るまで: {waitSec.toFixed(1)} 秒
        </p>
      )}
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
        onEnded={() => playing.current && playNext()}
        onError={() => playing.current && playNext()}
        preload="none"
      />
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        1 回に話すのは 1 分くらいまでがおすすめです。会話は文字の相談と同じく履歴に残ります。
      </p>
    </section>
  );
}
