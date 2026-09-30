"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Work OS web voice input (record → transcribe → review).
 *
 * The web twin of the companion's `chat/voiceInput.ts`, deliberately separate:
 * the two apps have different bundlers, auth, and upload paths, and the web
 * check-in composer is not the chat composer. Both keep the same contract so
 * the employee sees one behavior.
 *
 * Nothing is captured on mount, on focus, or on render.
 */

/** A 120s opus clip stays near 0.5MB, well inside the route's 8MB cap. */
export const VOICE_MAX_RECORDING_MS = 120_000;
/** A tap shorter than this cannot hold an utterance; it is discarded quietly
 * instead of surfacing a "no speech" error. */
export const VOICE_MIN_RECORDING_MS = 500;
export const VOICE_HOTKEY_LABEL = "Ctrl + M";
/** Margin over the route's 25s provider timeout, and inside the edge proxy's
 * own deadline so its error page can never replace ours. */
const VOICE_UPLOAD_TIMEOUT_MS = 35_000;
const VOICE_RECEIPT_MS = 5_000;

export type VoiceState = "idle" | "requesting" | "recording" | "transcribing";
export type VoiceFailure = "unsupported" | "permission" | "device" | "start" | "transcribe" | "network";

export interface VoiceInput {
  state: VoiceState;
  level: number;
  elapsedMs: number;
  maxMs: number;
  error: string | null;
  receipt: boolean;
  supported: boolean;
  dismissError: () => void;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

export const VOICE_FAILURE_COPY: Record<VoiceFailure, string> = {
  unsupported: "This browser can’t record audio. Voice input is unavailable.",
  permission: "Microphone access is blocked. Allow it for this site in your browser, then try again.",
  device: "No microphone was found. Connect one and try again.",
  start: "Recording couldn’t start. Try again.",
  transcribe: "We couldn’t transcribe that recording. Try again.",
  network: "The recording couldn’t reach the workspace. Check your connection and try again.",
};

/** First container both the recorder and the transcription provider accept. */
export function pickRecorderMime(isTypeSupported: (type: string) => boolean): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((type) => isTypeSupported(type)) ?? "";
}

export function recorderFileExtension(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}

/** `0:07` — the recording clock, tabular by convention in the composer. */
export function formatRecordingClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Peak amplitude of one analyser frame, scaled for a small bar meter. */
export function levelFromWaveform(samples: Uint8Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const distance = Math.abs(samples[index] - 128);
    if (distance > peak) peak = distance;
  }
  return Math.min(1, peak / 96);
}

function classifyStartFailure(error: unknown): VoiceFailure {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "device";
  return "start";
}

export function useVoiceInput(options: {
  onTranscript: (text: string) => void;
  enabled?: boolean;
  language?: string;
}): VoiceInput {
  const { onTranscript, enabled = true, language = "en" } = options;
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState(false);
  const [supported, setSupported] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const audioRef = useRef<{ context: AudioContext; source: MediaStreamAudioSourceNode } | null>(null);
  const frameRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  /* A stopped MediaRecorder reports "inactive" before `onstop` lands, so a
     second stop without this guard would upload the same clip twice. */
  const finishingRef = useRef(false);
  /* Set synchronously by `start`, before the microphone is awaited, so two
     start requests in one tick cannot both open a recorder. */
  const startingRef = useRef(false);
  /* Identifies the live capture: a settled older one must not move the state
     out from under a newer capture, and an older microphone request must abort
     instead of leaving a second recorder running. */
  const captureIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const releaseMedia = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      try { audio.source.disconnect(); } catch { /* teardown is best-effort */ }
      void audio.context.close().catch(() => undefined);
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    setLevel(0);
  }, []);

  const upload = useCallback(async (blob: Blob, mime: string, captureId: number) => {
    const form = new FormData();
    form.append("audio", blob, `voice.${recorderFileExtension(mime)}`);
    form.append("mime", mime);
    form.append("language", language);
    try {
      /* Outlast the server's own 25s provider timeout: giving up first would
         abandon a clip the route is still transcribing. */
      const response = await fetch("/api/work-os/voice/transcribe", {
        method: "POST",
        body: form,
        credentials: "same-origin",
        signal: AbortSignal.timeout(VOICE_UPLOAD_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({})) as { text?: unknown; error?: unknown };
      if (!mountedRef.current) return;
      if (!response.ok) {
        setError(typeof body.error === "string" && body.error ? body.error : VOICE_FAILURE_COPY.transcribe);
        return;
      }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        setError(VOICE_FAILURE_COPY.transcribe);
        return;
      }
      onTranscript(text);
      setReceipt(true);
    } catch {
      if (mountedRef.current) setError(VOICE_FAILURE_COPY.network);
    } finally {
      /* A newer hold may already own the composer by now. */
      if (mountedRef.current && captureId === captureIdRef.current) setState("idle");
    }
  }, [language, onTranscript]);

  const finish = useCallback((cancelled: boolean, captureId: number) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const mime = mimeRef.current;
    const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    releaseMedia();
    startingRef.current = false;
    /* Only the newest capture writes the state; an older one still hands its
       audio over, so nothing the employee said is lost. */
    const ownsComposer = () => captureId === captureIdRef.current;
    if (cancelled || durationMs < VOICE_MIN_RECORDING_MS) {
      if (ownsComposer()) {
        setElapsedMs(0);
        setState("idle");
      }
      return;
    }
    const blob = new Blob(chunks, { type: mime || "audio/webm" });
    if (!blob.size) {
      if (ownsComposer()) {
        setElapsedMs(0);
        setState("idle");
      }
      return;
    }
    if (ownsComposer()) setState("transcribing");
    void upload(blob, mime || blob.type, captureId);
  }, [releaseMedia, upload]);

  const stop = useCallback(() => {
    if (state === "requesting") {
      stopRequestedRef.current = true;
      return;
    }
    if (state !== "recording") return;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { finish(false, captureIdRef.current); }
    } else finish(false, captureIdRef.current);
  }, [finish, state]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setElapsedMs(0);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { finish(true, captureIdRef.current); }
    } else {
      releaseMedia();
      finishingRef.current = true;
      startingRef.current = false;
      setState("idle");
    }
  }, [finish, releaseMedia]);


  const start = useCallback(() => {
    if (!enabled) return;
    /* Ref, not the `state` closure: two start requests in the same tick (a
       duplicated shortcut, or a hold landing while the microphone is still
       opening) would both read the same stale render and open two recorders. */
    if (startingRef.current) return;
    /* A hold is a deliberate act: it always opens the microphone. Refusing
       here is what made Ctrl + M feel unreliable — the previous upload takes a
       second or two, and any press inside that window did nothing at all. */
    /* A capture still running is stopped and kept rather than blocking the new
       hold, and a transcript still in flight must not block it either. */
    if (state === "recording" || state === "requesting") stop();
    /* A hold always opens the microphone once the previous clip is safely in
       flight: refusing during transcription is what made the shortcut feel
       unreliable, because the upload takes a second or two. The microphone is
       already closed by then, so no second stream can exist. A capture that is
       still running is refused, because stopping it here would let its
       teardown clear the newer capture's media references. */
    if (state === "recording" || state === "requesting") return;
    startingRef.current = true;
    const captureId = (captureIdRef.current += 1);
    finishingRef.current = false;
    setError(null);
    setReceipt(false);
    setElapsedMs(0);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      startingRef.current = false;
      setSupported(false);
      setError(VOICE_FAILURE_COPY.unsupported);
      return;
    }

    cancelledRef.current = false;
    stopRequestedRef.current = false;
    finishingRef.current = false;
    setState("requesting");

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (failure) {
        if (!mountedRef.current) return;
        startingRef.current = false;
        if (captureId !== captureIdRef.current) return;
        setState("idle");
        setError(VOICE_FAILURE_COPY[classifyStartFailure(failure)]);
        return;
      }
      /* A newer hold owns the microphone now. */
      if (cancelledRef.current || !mountedRef.current || captureId !== captureIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        startingRef.current = false;
        if (captureId === captureIdRef.current) setState("idle");
        return;
      }
      streamRef.current = stream;

      const mime = pickRecorderMime((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type));
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch {
        releaseMedia();
        startingRef.current = false;
        setState("idle");
        setError(VOICE_FAILURE_COPY.start);
        return;
      }
      recorderRef.current = recorder;
      mimeRef.current = recorder.mimeType || mime || "audio/webm";
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => finish(cancelledRef.current, captureId);
      recorder.onerror = () => {
        releaseMedia();
        startingRef.current = false;
        if (!mountedRef.current) return;
        if (captureId === captureIdRef.current) setState("idle");
        setError(VOICE_FAILURE_COPY.start);
      };

      try {
        recorder.start(250);
      } catch {
        releaseMedia();
        startingRef.current = false;
        setState("idle");
        setError(VOICE_FAILURE_COPY.start);
        return;
      }

      if (captureId !== captureIdRef.current) {
        try { recorder.stop(); } catch { /* the newer capture owns the microphone */ }
        return;
      }
      startedAtRef.current = Date.now();
      setState("recording");

      /* The live meter reads the real signal, so it is data rather than an
         ambient decoration; it exists only while the microphone is open. */
      try {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        audioRef.current = { context, source };
        const samples = new Uint8Array(analyser.fftSize);
        const draw = () => {
          if (!audioRef.current) return;
          analyser.getByteTimeDomainData(samples);
          setLevel(levelFromWaveform(samples));
          frameRef.current = requestAnimationFrame(draw);
        };
        frameRef.current = requestAnimationFrame(draw);
      } catch {
        /* A missing AudioContext only costs the meter, never the recording. */
      }

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= VOICE_MAX_RECORDING_MS) {
          const active = recorderRef.current;
          if (active && active.state !== "inactive") active.stop();
          else finish(false, captureId);
        }
      }, 200);

      if (stopRequestedRef.current) {
        stopRequestedRef.current = false;
        if (recorder.state !== "inactive") recorder.stop();
      }
    })();
  }, [enabled, finish, releaseMedia, state, stop]);


  /* A backgrounded tab must never leave the microphone open: stop and keep
     whatever was already spoken. */
  useEffect(() => {
    if (state !== "recording" && state !== "requesting") return;
    const onHidden = () => { if (document.visibilityState === "hidden") stop(); };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [state, stop]);

  useEffect(() => {
    if (!receipt) return;
    const timeout = setTimeout(() => setReceipt(false), VOICE_RECEIPT_MS);
    return () => clearTimeout(timeout);
  }, [receipt]);

  useEffect(() => () => releaseMedia(), [releaseMedia]);

  return {
    state,
    level,
    elapsedMs,
    maxMs: VOICE_MAX_RECORDING_MS,
    error,
    receipt,
    supported,
    dismissError: useCallback(() => setError(null), []),
    start,
    stop,
    cancel,
  };
}
