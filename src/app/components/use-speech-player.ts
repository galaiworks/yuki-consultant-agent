"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** ボタン操作の瞬間に無音を再生し、Safari でも後続の音声を再生できるようにする */
export function silentWavUrl(): string {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const text = (o: number, t: string) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  text(0, "RIFF"); v.setUint32(4, 36 + samples, true); text(8, "WAVE"); text(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  text(36, "data"); v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** 届いた音声を順に再生し、停止・会話切り替え後の音声は捨てる */
export function useSpeechPlayer() {
  const audio = useRef<HTMLAudioElement>(null);
  const queue = useRef<string[]>([]);
  const enabled = useRef(false);
  const playing = useRef(false);
  const attempt = useRef(0);
  const silent = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const nextRef = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    enabled.current = false;
    queue.current = [];
    playing.current = false;
    attempt.current++;
    if (audio.current) {
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.pause();
    }
    if (silent.current) URL.revokeObjectURL(silent.current);
    silent.current = null;
    setIsPlaying(false);
  }, []);

  const next = useCallback(() => {
    const el = audio.current;
    const item = queue.current.shift();
    if (!enabled.current || !el || !item) {
      playing.current = false;
      setIsPlaying(false);
      return;
    }
    const id = ++attempt.current;
    playing.current = true;
    setIsPlaying(true);
    el.onended = () => { if (id === attempt.current && playing.current) nextRef.current(); };
    const fail = () => {
      if (id !== attempt.current || !enabled.current) return;
      stop();
      setError("音声を再生できませんでした。ブラウザの音声設定を確認して、もう一度送信してください。");
    };
    el.onerror = fail;
    el.src = `data:audio/mpeg;base64,${item}`;
    if (silent.current) URL.revokeObjectURL(silent.current);
    silent.current = null;
    void el.play().catch(fail);
  }, [stop]);
  nextRef.current = next;

  /** await より前、送信ボタンのイベント内で呼ぶ */
  const begin = useCallback(() => {
    stop();
    setError("");
    enabled.current = true;
    if (audio.current) {
      silent.current = silentWavUrl();
      audio.current.src = silent.current;
      void audio.current.play().catch(() => {});
    }
  }, [stop]);

  const enqueue = useCallback((item: string) => {
    if (!enabled.current) return;
    queue.current.push(item);
    if (!playing.current) nextRef.current();
  }, []);

  useEffect(() => {
    // React が ref を外したあとでも、切り替え前の要素を確実に止める。
    const el = audio.current;
    return () => {
      stop();
      if (el) {
        el.onended = null;
        el.onerror = null;
        el.pause();
      }
    };
  }, [stop]);
  return { audio, begin, enqueue, stop, isPlaying, error };
}
