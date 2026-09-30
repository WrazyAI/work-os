"use client";

import { useCallback, useEffect, useRef } from "react";
import { Mic, Send, Square, TimerReset, X } from "lucide-react";
import { formatRecordingClock, useVoiceInput, VOICE_HOTKEY_LABEL, type VoiceInput } from "./useVoiceInput";

/** Bar weights for the live meter: a real signal, never a decorative loop. */
const METER_BARS = [0.45, 0.75, 1, 0.75, 0.45];

function VoiceMeter({ level }: { level: number }) {
  return (
    <span className="inline-flex h-4 items-center gap-0.5" aria-hidden="true">
      {METER_BARS.map((weight, index) => (
        <span
          key={index}
          className="w-0.5 rounded-full"
          style={{ height: `${Math.max(3, Math.round(level * weight * 16))}px`, background: "var(--accent)" }}
        />
      ))}
    </span>
  );
}

/**
 * The web check-in composer: the field, its actions, and voice input.
 *
 * Same one-interaction contract as the companion composer — the record
 * affordance replaces the send while the draft is empty, a hold owns the whole
 * capture, and a transcript lands in the draft for review before anything is
 * sent. Nothing is captured without an explicit press or hold.
 */
export function CheckInComposer({
  value,
  onChange,
  onSend,
  onSnooze,
  busy,
  voiceEnabled,
  voice,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  onSnooze?: () => void;
  busy: boolean;
  voiceEnabled: boolean;
  /** The recorded transcript, inserted into the draft for review. */
  voice: VoiceInput;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  /* The hold-to-talk listener is registered once; this ref keeps it on the
     newest recorder without re-subscribing on every render. */
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);

  const capturing = voice.state === "requesting" || voice.state === "recording";
  const transcribing = voice.state === "transcribing";
  const showRecord = voiceEnabled && voice.supported && !capturing && !transcribing && !value.trim();

  /* Push-to-talk: Ctrl + M reaches the check-in from anywhere on the page. The
     hold owns the capture, so releasing it always ends the recording. */
  useEffect(() => {
    if (!voiceEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      if (event.key !== "m" && event.key !== "M") return;
      event.preventDefault();
      if (voiceRef.current.state !== "idle") return;
      fieldRef.current?.scrollIntoView({ block: "nearest" });
      fieldRef.current?.focus();
      voiceRef.current.start();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "m" && event.key !== "M") return;
      voiceRef.current.stop();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [voiceEnabled]);

  return (
    <div data-voice-state={voice.state}>
      <textarea
        ref={fieldRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        readOnly={capturing || transcribing}
        placeholder={
          capturing
            ? "Listening…"
            : transcribing
              ? "Transcribing your recording…"
              : "Describe what you plan to do, progress made, blockers, or completed work."
        }
        className="w-full resize-y border bg-transparent px-3 py-2 text-[13px] leading-6 text-[var(--text-primary)] outline-none"
        style={{ borderColor: capturing ? "var(--accent)" : "var(--border)" }}
        aria-label="Describe what you plan to do, progress made, blockers, or completed work"
      />

      {capturing ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-secondary)]" data-voice-status role="status">
          <VoiceMeter level={voice.level} />
          <span className="tabular-nums">{formatRecordingClock(voice.elapsedMs)} / {formatRecordingClock(voice.maxMs)}</span>
          <span className="text-[var(--text-tertiary)]">Hold {VOICE_HOTKEY_LABEL} to talk</span>
          <button type="button" onClick={() => voice.cancel()} className="inline-flex items-center gap-1 border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--border)" }}>
            <X size={12} /> Cancel
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {showRecord ? (
          <button
            type="button"
            onClick={() => voice.start()}
            aria-keyshortcuts="Control+M"
            className="inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-semibold"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            <Mic size={14} /> Record update
          </button>
        ) : capturing ? (
          <button
            type="button"
            onClick={() => voice.stop()}
            className="inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold"
            style={{ background: "var(--signal)", color: "var(--signal-ink)" }}
          >
            <Square size={13} fill="currentColor" /> Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={!value.trim() || busy || transcribing}
            onClick={onSend}
            className="inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold disabled:opacity-50"
            style={{ background: "var(--signal)", color: "var(--signal-ink)" }}
          >
            <Send size={14} /> {transcribing ? "Transcribing…" : "Send update"}
          </button>
        )}
        {onSnooze ? (
          <button
            type="button"
            disabled={busy || transcribing}
            onClick={onSnooze}
            className="ml-auto inline-flex items-center gap-2 border px-3 py-2 text-[12px] text-[var(--text-tertiary)] disabled:opacity-50"
            style={{ borderColor: "var(--border)" }}
          >
            <TimerReset size={14} /> 30 min
          </button>
        ) : null}
      </div>

      {voice.error ? (
        <p className="mt-2 flex items-center gap-2 text-[11px] leading-5" style={{ color: "var(--status-error)" }} role="status" data-voice-error>
          <span>{voice.error}</span>
          <button type="button" onClick={() => voice.dismissError()} className="font-semibold underline" aria-label="Dismiss voice input message">Dismiss</button>
        </p>
      ) : voice.receipt ? (
        <p className="mt-2 text-[11px] leading-5" style={{ color: "var(--accent)" }} role="status" data-voice-receipt>
          Transcribed — review it, then send.
        </p>
      ) : null}
    </div>
  );
}

/** Owns the recorder for the web check-in so the field, the hotkey, and the
 * transcript insertion stay one seam. */
export function useCheckInVoice(value: string, onChange: (next: string) => void, enabled: boolean) {
  const append = useCallback((text: string) => {
    onChange(value.trim() ? `${value.trimEnd()} ${text}` : text);
  }, [onChange, value]);
  return useVoiceInput({ onTranscript: append, enabled });
}
