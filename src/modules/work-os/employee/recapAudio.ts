"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The words the server actually spoke, exactly as the recap's own lines. */
export type RecapReadLine = { text: string; time: string | null };

export type RecapReadState = {
  /** The recap this read belongs to, or null at rest. */
  intervalId: string | null;
  status: "idle" | "loading" | "playing" | "finished";
  /** 0–1 of the clip's own duration. */
  progress: number;
  activeIndex: number;
  lines: RecapReadLine[];
  error: string | null;
};

const IDLE: RecapReadState = { intervalId: null, status: "idle", progress: 0, activeIndex: 0, lines: [], error: null };
const UNAVAILABLE = "Reading that recap is unavailable right now. Try again in a moment.";

/** A quarter second of silence, as a valid PCM WAV. Generated rather than
 * shipped: the browser needs *something* to start inside the press. */
export function silentWav(): ArrayBuffer {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate / 4);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return buffer;
}

/** Longer lines take longer to say; the highlight follows that, not equal
 * slices, so it stays with the voice instead of racing ahead on short lines. */
export function lineWeights(lines: RecapReadLine[]): number[] {
  return lines.map((line) => Math.max(1, line.text.trim().length + (line.time ? line.time.length + 2 : 0)));
}

export function activeLineIndex(progress: number, weights: number[]): number {
  if (!weights.length) return 0;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < weights.length; index += 1) {
    remaining -= weights[index];
    if (remaining <= 0) return index;
  }
  return weights.length - 1;
}

export function parseLines(header: string | null): RecapReadLine[] {
  if (!header) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(header));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string"
      ? [{ text: (entry as { text: string }).text, time: typeof (entry as { time?: unknown }).time === "string" ? (entry as { time: string }).time : null }]
      : []);
  } catch {
    return [];
  }
}

/**
 * One recap read for the whole stream: press Listen, hear the recap's own
 * lines, and follow them as they are spoken. The element is started with a
 * silent source inside the press, because the clip takes seconds to synthesize
 * and the browser stops honouring the gesture before it arrives.
 */
export function useRecapRead(options: { onStale?: () => void } = {}) {
  const [state, setState] = useState<RecapReadState>(IDLE);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const primeUrlRef = useRef<string | null>(null);
  const tokenRef = useRef(0);
  const onStaleRef = useRef(options.onStale);
  useEffect(() => { onStaleRef.current = options.onStale; }, [options.onStale]);

  const release = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.ontimeupdate = null;
      audioRef.current = null;
    }
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current);
      clipUrlRef.current = null;
    }
    if (primeUrlRef.current) {
      URL.revokeObjectURL(primeUrlRef.current);
      primeUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    release();
    setState((current) => (current.status === "idle" ? current : IDLE));
  }, [release]);

  const toggle = useCallback(async (interval: { id: string; revision?: number }) => {
    if (state.intervalId === interval.id && state.status !== "idle") {
      stop();
      return;
    }
    const mine = (tokenRef.current += 1);
    release();
    // Inside the press: the element is allowed to play from here on.
    const audio = new Audio();
    try {
      const prime = URL.createObjectURL(new Blob([silentWav()], { type: "audio/wav" }));
      primeUrlRef.current = prime;
      audio.src = prime;
      void audio.play().catch(() => { /* best effort: the clip tries anyway */ });
    } catch {
      /* The real play reports its own failure. */
    }
    audioRef.current = audio;
    setState({ ...IDLE, intervalId: interval.id, status: "loading" });

    try {
      const response = await fetch("/api/work-os/voice/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalId: interval.id, revision: interval.revision ?? null }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof detail?.error === "string" && detail.error ? detail.error : UNAVAILABLE);
      }
      if (mine !== tokenRef.current) return;
      if (response.headers.get("x-work-os-recap-stale") === "1") onStaleRef.current?.();
      const lines = parseLines(response.headers.get("x-work-os-recap-lines"));
      const blob = await response.blob();
      if (mine !== tokenRef.current) return;

      audio.pause();
      if (primeUrlRef.current) {
        URL.revokeObjectURL(primeUrlRef.current);
        primeUrlRef.current = null;
      }
      const clipUrl = URL.createObjectURL(blob);
      clipUrlRef.current = clipUrl;
      audio.src = clipUrl;
      audio.load();
      const weights = lineWeights(lines);
      audio.ontimeupdate = () => {
        if (mine !== tokenRef.current) return;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
        const progress = duration ? Math.min(1, Math.max(0, audio.currentTime / duration)) : 0;
        setState((current) => ({ ...current, progress, activeIndex: activeLineIndex(progress, weights) }));
      };
      audio.onended = () => {
        if (mine !== tokenRef.current) return;
        release();
        setState({ ...IDLE, intervalId: interval.id, status: "finished", progress: 1, activeIndex: Math.max(0, lines.length - 1), lines });
      };
      audio.onerror = () => {
        if (mine !== tokenRef.current) return;
        release();
        setState({ ...IDLE, intervalId: interval.id, error: UNAVAILABLE });
      };
      setState({ intervalId: interval.id, status: "playing", progress: 0, activeIndex: 0, lines, error: null });
      await audio.play();
    } catch (error) {
      if (mine !== tokenRef.current) return;
      release();
      setState({ ...IDLE, intervalId: interval.id, error: error instanceof Error && error.message ? error.message : UNAVAILABLE });
    }
  }, [release, state.intervalId, state.status, stop]);

  useEffect(() => () => release(), [release]);

  return { state, toggle, stop };
}
