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

type RecorderContext = AudioContext & { decodeAudioData?: AudioContext["decodeAudioData"] };

/**
 * One recap read for the whole stream: press Listen, hear the recap's own
 * lines, and follow them as they are spoken.
 *
 * Playback runs on Web Audio, and the context is opened inside the press. A
 * media element would refuse to start after a slow synthesis (the browser stops
 * counting the click as a gesture); a running context does not care how long
 * the clip took, and it needs no blob URL for the media-src policy to block.
 */
export function useRecapRead(options: { onStale?: () => void } = {}) {
  const [state, setState] = useState<RecapReadState>(IDLE);
  const contextRef = useRef<RecorderContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef(0);
  const onStaleRef = useRef(options.onStale);
  useEffect(() => { onStaleRef.current = options.onStale; }, [options.onStale]);

  const release = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try {
        sourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current = null;
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

    // Inside the press: the context is created and resumed here, so the clip
    // can play whenever it arrives.
    let context = contextRef.current;
    try {
      if (!context) {
        const Constructor = (window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (!Constructor) throw new Error("Audio is not available in this browser.");
        context = new Constructor() as RecorderContext;
        contextRef.current = context;
      }
      void context.resume().catch(() => undefined);
    } catch {
      context = null;
    }

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
      const bytes = await response.arrayBuffer();
      if (mine !== tokenRef.current) return;
      if (!context) throw new Error(UNAVAILABLE);

      const buffer = await context.decodeAudioData(bytes);
      if (mine !== tokenRef.current) return;
      const weights = lineWeights(lines);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (mine !== tokenRef.current) return;
        release();
        setState({ ...IDLE, intervalId: interval.id, status: "finished", progress: 1, activeIndex: Math.max(0, lines.length - 1), lines });
      };
      source.start();
      sourceRef.current = source;
      const startedAt = context.currentTime;
      setState({ intervalId: interval.id, status: "playing", progress: 0, activeIndex: 0, lines, error: null });
      timerRef.current = setInterval(() => {
        if (mine !== tokenRef.current || !context) return;
        const progress = buffer.duration > 0 ? Math.min(1, Math.max(0, (context.currentTime - startedAt) / buffer.duration)) : 0;
        setState((current) => ({ ...current, progress, activeIndex: activeLineIndex(progress, weights) }));
      }, 100);
    } catch (error) {
      if (mine !== tokenRef.current) return;
      release();
      setState({ ...IDLE, intervalId: interval.id, error: error instanceof Error && error.message ? error.message : UNAVAILABLE });
    }
  }, [release, state.intervalId, state.status, stop]);

  useEffect(() => () => {
    release();
    void contextRef.current?.close().catch(() => undefined);
  }, [release]);

  return { state, toggle, stop };
}
