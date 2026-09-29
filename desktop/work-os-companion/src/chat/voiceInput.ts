import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";

/**
 * Work OS voice input (record → transcribe → review).
 *
 * One seam owns the whole capture contract so both chat delivery surfaces and
 * the web check-in composer behave identically: the microphone is opened only
 * for an explicit press or hold, the clip is capped, the audio is streamed to
 * the server proxy and dropped, and the transcript lands in the draft for the
 * employee to review before anything is sent.
 *
 * Nothing is captured on mount, on focus, or on render.
 */

/** Keep in step with `TRANSCRIBE_MAX_BYTES` in `src/lib/aiTranscribe.ts`: a
 * 120s opus clip stays near 0.5MB. */
export const VOICE_MAX_RECORDING_MS = 120_000;
/** A tap shorter than this cannot hold an utterance; it is discarded quietly
 * instead of surfacing a "no speech" error. */
export const VOICE_MIN_RECORDING_MS = 500;
/** Display label for the registered global hold-to-talk shortcut. The binding
 * itself is registered in `src-tauri/src/lib.rs`. */
export const VOICE_HOTKEY_LABEL = "Ctrl + M";
/** Margin over the route's 45s provider timeout. */
const VOICE_UPLOAD_TIMEOUT_MS = 55_000;

export type VoiceState = "idle" | "requesting" | "recording" | "transcribing";
export type VoiceFailure = "unsupported" | "permission" | "device" | "start" | "transcribe" | "network";

export interface VoiceInput {
  state: VoiceState;
  /** 0..1, driven by the live microphone signal. Zero when not recording. */
  level: number;
  elapsedMs: number;
  maxMs: number;
  error: string | null;
  /** True briefly after a transcript lands, so the composer can say so. */
  receipt: boolean;
  /** False when this runtime has no microphone capture at all. */
  supported: boolean;
  dismissError: () => void;
  start: (source?: "button" | "hotkey") => void;
  stop: () => void;
  cancel: () => void;
}

export const VOICE_FAILURE_COPY: Record<VoiceFailure, string> = {
  unsupported: "This build can’t record audio. Voice input is unavailable.",
  permission: "Microphone access is blocked. Allow it for Work OS in Windows settings, then try again.",
  device: "No microphone was found. Connect one and try again.",
  start: "Recording couldn’t start. Try again.",
  transcribe: "We couldn’t transcribe that recording. Try again.",
  network: "The recording couldn’t reach the workspace. Check your connection and try again.",
};

/** How long the “Transcribed” receipt stays up before the composer settles. */
const VOICE_RECEIPT_MS = 5_000;

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
  /** Insert the transcript. The caller owns the draft and the send authority. */
  onTranscript: (text: string) => void;
  /** Called when a recording begins so the owning surface can open or focus. */
  onRecordingStart?: () => void;
  enabled?: boolean;
  language?: string;
}): VoiceInput {
  const { onTranscript, onRecordingStart, enabled = true, language = "en" } = options;
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

  const upload = useCallback(async (blob: Blob, mime: string) => {
    const form = new FormData();
    form.append("audio", blob, `voice.${recorderFileExtension(mime)}`);
    form.append("mime", mime);
    form.append("language", language);
    try {
      /* Outlast the server's own 45s provider timeout: giving up first would
         abandon a clip the route is still transcribing. */
      const result = await apiRequest<{ text?: string }>("/api/work-os/voice/transcribe", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(VOICE_UPLOAD_TIMEOUT_MS),
      });
      const text = typeof result?.text === "string" ? result.text.trim() : "";
      if (!mountedRef.current) return;
      if (!text) {
        setError(VOICE_FAILURE_COPY.transcribe);
        return;
      }
      onTranscript(text);
      setReceipt(true);
    } catch (failure) {
      if (!mountedRef.current) return;
      const message = failure instanceof Error ? failure.message : "";
      setError(message || VOICE_FAILURE_COPY.network);
    } finally {
      if (mountedRef.current) setState("idle");
    }
  }, [language, onTranscript]);

  const finish = useCallback((cancelled: boolean) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const mime = mimeRef.current;
    const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    releaseMedia();
    if (cancelled || durationMs < VOICE_MIN_RECORDING_MS) {
      setElapsedMs(0);
      setState("idle");
      return;
    }
    const blob = new Blob(chunks, { type: mime || "audio/webm" });
    if (!blob.size) {
      setElapsedMs(0);
      setState("idle");
      return;
    }
    setState("transcribing");
    void upload(blob, mime || blob.type);
  }, [releaseMedia, upload]);

  const start = useCallback((_source: "button" | "hotkey" = "button") => {
    if (!enabled) return;
    if (state !== "idle") return;
    setError(null);
    setReceipt(false);
    setElapsedMs(0);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setSupported(false);
      setError(VOICE_FAILURE_COPY.unsupported);
      return;
    }

    cancelledRef.current = false;
    stopRequestedRef.current = false;
    finishingRef.current = false;
    setState("requesting");
    onRecordingStart?.();

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (failure) {
        if (!mountedRef.current) return;
        setState("idle");
        setError(VOICE_FAILURE_COPY[classifyStartFailure(failure)]);
        return;
      }
      if (cancelledRef.current || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setState("idle");
        return;
      }
      streamRef.current = stream;

      const mime = pickRecorderMime((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type));
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      } catch (failure) {
        releaseMedia();
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
      recorder.onstop = () => finish(cancelledRef.current);
      recorder.onerror = () => {
        releaseMedia();
        if (!mountedRef.current) return;
        setState("idle");
        setError(VOICE_FAILURE_COPY.start);
      };

      try {
        recorder.start(250);
      } catch (failure) {
        releaseMedia();
        setState("idle");
        setError(VOICE_FAILURE_COPY.start);
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
          else finish(false);
        }
      }, 200);

      /* A hold released before the microphone opened still ends the capture
         instead of leaving it running. */
      if (stopRequestedRef.current) {
        stopRequestedRef.current = false;
        if (recorder.state !== "inactive") recorder.stop();
      }
    })();
  }, [enabled, finish, onRecordingStart, releaseMedia, state]);

  const stop = useCallback(() => {
    if (state === "requesting") {
      stopRequestedRef.current = true;
      return;
    }
    if (state !== "recording") return;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { finish(false); }
    } else finish(false);
  }, [finish, state]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setElapsedMs(0);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { finish(true); }
    } else {
      releaseMedia();
      finishingRef.current = true;
      setState("idle");
    }
  }, [finish, releaseMedia]);

  /* Leaving the window must never leave the microphone open: stop and keep
     whatever was already spoken. */
  useEffect(() => {
    if (state !== "recording" && state !== "requesting") return;
    const onBlur = () => stop();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
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
