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
 * 「マイクに音がまったく届いていない」とみなす境目(瞬間の最大の振れ幅)。
 * 自動停止の境目よりずっと小さくし、小声でも捨てないようにする。ミュートのマイクはほぼ 0 になる
 */
const ANY_SOUND_PEAK = 0.004;

/**
 * 録音中の音量を見て、話し終わって少し黙ったら onSilence を呼ぶ。
 * 一度も話し声が聞こえないうちは止めない。止めるための関数を返す。
 * ブラウザが音量を取れないとき(古い iPhone など)は何もしない(ボタンで止められる)。
 */
function watchSilence(
  stream: MediaStream,
  onSilence: () => void,
  onLevel: (level: number) => void,
  onSound: () => void,
  onMeasured: () => void,
): (() => void) | null {
  let ctx: AudioContext;
  let analyser: AnalyserNode;
  try {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
  } catch {
    // 音量が取れないブラウザでは null を返す(声が聞こえたかは判断しない)
    return null;
  }
  void ctx.resume().catch(() => {});
  const data = new Float32Array(analyser.fftSize);
  const started = Date.now();
  let heard = false;
  let lastVoice = Date.now();
  const timer = setInterval(() => {
    // 録音の上限は、音量を測れるかどうかに関係なく守る
    if (Date.now() - started > MAX_RECORD_MS) {
      stop();
      onSilence();
      return;
    }
    // 音を処理できる状態のときだけ「測れた」と数える(Safari などで止まったままなら判断しない)
    if (ctx.state !== "running") return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    let peak = 0;
    for (const v of data) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const level = Math.sqrt(sum / data.length);
    onMeasured();
    onLevel(level);
    if (peak > ANY_SOUND_PEAK) onSound();
    const now = Date.now();
    if (level > VOICE_LEVEL) {
      heard = true;
      lastVoice = now;
    }
    if (heard && now - lastVoice > SILENCE_MS) {
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

/** 選んだマイクをこの端末に覚えておく(読み書きできない環境でも動くようにする) */
const MIC_KEY = "yuki.voice.micId";
function loadMicId(): string {
  try {
    return window.localStorage.getItem(MIC_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveMicId(id: string) {
  try {
    if (id) window.localStorage.setItem(MIC_KEY, id);
    else window.localStorage.removeItem(MIC_KEY);
  } catch {
    // 保存できなくても、このページを開いている間は選んだマイクを使う
  }
}

/** 選んだマイクで録音を始める。そのマイクが無くなっていたら、既定のマイクに戻す */
async function openMic(micId: string): Promise<{ stream: MediaStream; fellBack: boolean }> {
  if (micId) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: micId } } }), fellBack: false };
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name !== "OverconstrainedError" && name !== "NotFoundError") throw e;
    }
  }
  return { stream: await navigator.mediaDevices.getUserMedia({ audio: true }), fellBack: Boolean(micId) };
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
  // マイクの一覧と、選んでいるマイク(空 = ブラウザの既定)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [level, setLevel] = useState(0);
  // 録音中にマイクの音を測れたか・何か音が届いたか。測れなかったときは無音と決めつけない
  const measured = useRef(false);
  const sound = useRef(false);
  const conversationId = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const player = useRef<HTMLAudioElement | null>(null);
  const stopWatch = useRef<() => void>(() => {});
  // 区切りごとに届く YUKI の声を、届いた順に 1 つずつ再生する。pauseMs は再生後に置く無音(間)
  const queue = useRef<{ audio: string; pauseMs: number }[]>([]);
  const pauseAfter = useRef(0);
  const gapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playing = useRef(false);
  const replyDone = useRef(true);
  const sentAt = useRef(0);
  const [waitSec, setWaitSec] = useState<number | null>(null);

  // 再生 1 回ごとの番号。失敗時に error と play() の失敗が両方来ても、次へ進むのは 1 回だけにする
  const attempt = useRef(0);

  const playNext = useCallback(() => {
    const id = ++attempt.current;
    const el = player.current;
    const next = queue.current.shift();
    if (!el || !next) {
      playing.current = false;
      if (replyDone.current) setPhase((p) => (p === "speaking" || p === "thinking" ? "idle" : p));
      return;
    }
    playing.current = true;
    pauseAfter.current = next.pauseMs;
    if (sentAt.current) {
      setWaitSec((Date.now() - sentAt.current) / 1000);
      sentAt.current = 0;
    }
    setPhase("speaking");
    el.src = `data:audio/mpeg;base64,${next.audio}`;
    el.play().catch(() => advanceRef.current(id));
  }, []);

  /** 再生 id の再生が終わった(または失敗した)ら、決まった間を置いて次の区切りへ進む。同じ id では 1 回だけ */
  const advance = useCallback(
    (id: number) => {
      if (id !== attempt.current || !playing.current || gapTimer.current) return;
      const wait = pauseAfter.current;
      if (wait <= 0) return playNext();
      gapTimer.current = setTimeout(() => {
        gapTimer.current = null;
        if (id === attempt.current) playNext();
      }, wait);
    },
    [playNext],
  );
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  /** つながっているマイクの一覧を読み直す(名前は、マイクの使用を許可したあとで表示される) */
  const refreshMics = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId));
    } catch {
      setMics([]);
    }
  }, []);

  useEffect(() => {
    setMicId(loadMicId());
    void refreshMics();
    // マイクを抜き差ししたら一覧を更新する
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshMics);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshMics);
  }, [refreshMics]);

  function chooseMic(id: string) {
    setMicId(id);
    saveMicId(id);
  }

  useEffect(
    () => () => {
      if (gapTimer.current) clearTimeout(gapTimer.current);
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
            queue.current.push({ audio: event.audio, pauseMs: event.pauseMs ?? 0 });
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
      const { stream, fellBack } = await openMic(micId);
      if (fellBack) {
        chooseMic("");
        setError("選んでいたマイクが見つからないため、既定のマイクで録音します");
      }
      // 許可が出るとマイクの名前が読めるようになるので、一覧を読み直す
      void refreshMics();
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stopWatch.current();
        stream.getTracks().forEach((t) => t.stop());
        setLevel(0);
        // 一度も声が聞こえなかったら送らない(無音を文字起こしすると、費用だけかかって何も返らない)
        if (measured.current && !sound.current) {
          setError("マイクに音が届いていません。「マイク」で、使っているマイクを選んでからもう一度お話しください");
          setPhase("idle");
          return;
        }
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
        void send(blob, (Date.now() - startedAt.current) / 1000);
      };
      recorder.current = rec;
      rec.start();
      startedAt.current = Date.now();
      // 話し終わって少し黙ったら、ボタンを押さなくても送る
      measured.current = false;
      sound.current = false;
      const stopper = watchSilence(
        stream,
        () => {
          if (rec.state === "recording") rec.stop();
        },
        setLevel,
        () => {
          sound.current = true;
        },
        () => {
          measured.current = true;
        },
      );
      stopWatch.current = stopper ?? (() => {});
      setPhase("recording");
    } catch {
      setError("マイクを使えませんでした。ブラウザでマイクの使用を許可してください");
      setPhase("idle");
    }
  }, [phase, send, micId, refreshMics]);

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
      <label htmlFor="mic" style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", fontWeight: 400 }}>
        <span className="muted">マイク</span>
        <select
          id="mic"
          value={micId}
          onChange={(e) => chooseMic(e.target.value)}
          disabled={phase !== "idle"}
          style={{ font: "inherit", padding: "6px 8px", maxWidth: "100%" }}
        >
          <option value="">ブラウザの既定のマイク</option>
          {/* 許可前などで一覧に出ていなくても、前回選んだマイクを表示して実際の設定と合わせる */}
          {micId && !mics.some((m) => m.deviceId === micId) && <option value={micId}>前回選んだマイク</option>}
          {mics.map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `マイク ${i + 1}`}
            </option>
          ))}
        </select>
        {mics.length > 0 && mics.every((m) => !m.label) && (
          <span className="muted" style={{ fontSize: 12 }}>一度「話す」を押してマイクを許可すると、名前が表示されます</span>
        )}
      </label>
      {phase === "recording" && (
        <div aria-label="マイクの音量" style={{ height: 6, background: "var(--line)", borderRadius: 3, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, Math.round((level / 0.15) * 100))}%`,
              background: "var(--accent)",
              transition: "width 80ms linear",
            }}
          />
        </div>
      )}
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
        onEnded={() => advance(attempt.current)}
        onError={() => advance(attempt.current)}
        preload="none"
      />
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        1 回に話すのは 1 分くらいまでがおすすめです。会話は文字の相談と同じく履歴に残ります。
      </p>
    </section>
  );
}
