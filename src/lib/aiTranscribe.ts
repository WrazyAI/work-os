/**
 * Work OS voice input: Fal.ai Cohere Transcribe behind a server-side proxy.
 *
 * The employee's browser records a short clip and posts it to
 * `/api/work-os/voice/transcribe`; this module turns those bytes into text.
 * The FAL key is server-only (Fal's own guidance: never ship it to a client),
 * the audio is streamed straight to the provider and never persisted or
 * logged, and a failed transcription is reported as a failure rather than
 * silently returning empty text.
 */

export const TRANSCRIBE_MODEL = "fal-ai/cohere-transcribe";

/** 45s covers a 120s push-to-talk clip with provider headroom; a slow
 * provider must fail honestly instead of leaving the composer stuck in
 * "Transcribing…". */
const TRANSCRIBE_TIMEOUT_MS = 45_000;

/** Well under the proxy's 10MB body-buffer truncation cliff, and far above a
 * 120s opus clip (~0.5MB). */
export const TRANSCRIBE_MAX_BYTES = 8 * 1024 * 1024;

/** Containers a browser MediaRecorder may produce that Fal accepts. */
export const TRANSCRIBE_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
] as const;

/** Cohere Transcribe's supported ISO 639-1 set. */
export const TRANSCRIBE_LANGUAGES = [
  "en", "fr", "de", "it", "es", "pt", "el", "nl", "pl", "zh", "ja", "ko", "vi", "ar",
] as const;

export type TranscribeFailure =
  | "not_configured"
  | "empty_audio"
  | "too_large"
  | "unsupported_audio"
  | "timeout"
  | "provider_error"
  | "malformed";

export type TranscribeResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: TranscribeFailure; detail?: string };

function falKey(): string | null {
  const key = process.env.FAL_API_KEY?.trim();
  return key ? key : null;
}

/** True when this deployment can transcribe at all. Readiness and the client's
 * capability line both come from here, so a missing key can never render a
 * record button that cannot work. */
export function voiceInputConfigured(): boolean {
  return falKey() !== null;
}

/** `audio/webm;codecs=opus` → `audio/webm`, without losing the parameters the
 * provider may want in the data URI. */
export function baseAudioMime(mime: string): string {
  return mime.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function supportedAudioMime(mime: string): boolean {
  const base = baseAudioMime(mime);
  return (TRANSCRIBE_MIME_TYPES as readonly string[]).includes(base);
}

export function normalizeLanguage(value: unknown): string {
  return typeof value === "string" && (TRANSCRIBE_LANGUAGES as readonly string[]).includes(value) ? value : "en";
}

/**
 * Reads one voice upload out of a multipart form: size, container, and the
 * bytes. The part's declared type wins only when it names a supported
 * container; the recorder also reports its own type separately, so an untyped
 * part still transcribes instead of failing the format check.
 */
export async function readVoiceUpload(form: FormData): Promise<
  { ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: TranscribeFailure }
> {
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return { ok: false, reason: "empty_audio" };
  if (audio.size > TRANSCRIBE_MAX_BYTES) return { ok: false, reason: "too_large" };
  const declared = typeof audio.type === "string" && supportedAudioMime(audio.type) ? audio.type : "";
  const reported = form.get("mime");
  const mime = declared || (typeof reported === "string" && supportedAudioMime(reported) ? reported : "");
  if (!mime) return { ok: false, reason: "unsupported_audio" };
  return { ok: true, bytes: new Uint8Array(await audio.arrayBuffer()), mime: baseAudioMime(mime) };
}

/**
 * Transcribe one recorded clip. `mime` keeps its codecs parameter; the caller
 * has already enforced the size and type guards (the route owns those so it can
 * return the right status codes).
 */
export async function transcribeAudio(input: {
  bytes: Uint8Array;
  mime: string;
  language?: unknown;
}): Promise<TranscribeResult> {
  const key = falKey();
  if (!key) return { ok: false, reason: "not_configured" };
  if (input.bytes.byteLength === 0) return { ok: false, reason: "empty_audio" };
  if (input.bytes.byteLength > TRANSCRIBE_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (!supportedAudioMime(input.mime)) return { ok: false, reason: "unsupported_audio" };

  const audioUrl = `data:${input.mime};base64,${Buffer.from(input.bytes).toString("base64")}`;
  let response: Response;
  try {
    response = await fetch(`https://fal.run/${TRANSCRIBE_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        language: normalizeLanguage(input.language),
        punctuation: true,
      }),
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "provider_error", detail: "The transcription provider could not be reached." };
  }

  const body = await response.json().catch(() => null) as { text?: unknown; detail?: unknown } | null;
  if (!response.ok) {
    return {
      ok: false,
      reason: "provider_error",
      detail: response.status === 402
        ? "The transcription provider account is out of credit."
        : "The transcription provider rejected this recording.",
    };
  }
  if (!body || typeof body.text !== "string") return { ok: false, reason: "malformed" };

  const text = body.text.trim();
  if (!text) return { ok: false, reason: "empty_audio" };

  return { ok: true, text, model: TRANSCRIBE_MODEL };
}
