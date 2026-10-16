/**
 * The words a recap is read aloud with.
 *
 * Exactly one source of truth: the lines are the recap's own text — the lead
 * line first, then each activity — with the clock time lifted out of the line
 * the way the card already lifts it into a pill. Nothing is paraphrased, no
 * connective words are added, and the flow chips, evidence counts, screenshots,
 * gap notes and recorded GitHub facts are never spoken (a read that invented or
 * dropped a detail would defeat the reason the employee is listening: to check
 * that what was recorded is what happened).
 *
 * The spoken text is what the prompter shows, because both come from here.
 */

import { splitActivityTime } from "./activity-time";

/** A recap longer than this is refused rather than billed and read; real
 * recaps are twelve activities of at most ten words each. */
export const RECAP_SPEECH_MAX_CHARS = 6000;

export type RecapSpeechLine = {
  /** The words Otto says. */
  text: string;
  /** The clock time the card shows as its own pill, or null. Never spoken. */
  time: string | null;
};

export type RecapSpeechSource = {
  detail?: string | null;
  headline?: string | null;
  activities?: unknown;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** The recap's own lines, in order: the lead line, then each activity. */
export function buildRecapSpeechLines(interval: RecapSpeechSource): RecapSpeechLine[] {
  const lead = clean(interval.detail) || clean(interval.headline);
  const activities = Array.isArray(interval.activities) ? interval.activities : [];
  const lines: RecapSpeechLine[] = [];
  if (lead) lines.push({ text: lead, time: null });
  for (const activity of activities) {
    const raw = clean(activity);
    if (!raw) continue;
    const { time, text } = splitActivityTime(raw);
    if (text) lines.push({ text, time });
  }
  const spoken = lines.reduce((total, line) => total + line.text.length, 0);
  if (spoken > RECAP_SPEECH_MAX_CHARS) {
    throw new Error("This recap is too long to read aloud.");
  }
  return lines;
}

/* ── Speaking them ─────────────────────────────────────────────────────────
 *
 * The provider (google/gemini-3.8-flash-tts on fal) returns a whole WAV file
 * and no word timings, which is why the client's prompter is driven by the
 * audio's own clock rather than by anything here. */

/** The provider voices the app offers: the operator's pick, by ear, from six
 * candidates. The companion's picker shows these under its own delivery names
 * ("Warm", "Calm", …); this list is the whitelist, and a test asserts the two
 * agree so a label can never drift from the voice it plays. */
export const RECAP_VOICES = ["Kore", "Charon", "Leda", "Iapetus"] as const;
export const DEFAULT_RECAP_VOICE: string = RECAP_VOICES[0];

/** Delivery, never transcript: the words stay exactly the recap's own. */
export const RECAP_STYLE_INSTRUCTIONS =
  "Warm and unhurried, a colleague catching you up rather than a narrator reading a list. Short pauses between lines, no emphasis on any single one.";

export type RecapSpeechFailure =
  | "not_configured"
  | "empty"
  | "too_long"
  | "provider_error"
  | "timeout"
  | "malformed";

export type RecapSpeechResult =
  | { ok: true; audio: Uint8Array; mimeType: string; voice: string }
  | { ok: false; reason: RecapSpeechFailure };

const PROVIDER_URL = "https://fal.run/google/gemini-3.8-flash-tts";
const PROVIDER_TIMEOUT_MS = 25_000;

export function recapSpeechConfigured(): boolean {
  return Boolean(process.env.FAL_API_KEY?.trim());
}

/** The employee-facing copy for a failure. Never a provider payload, never a
 * status code (design §9 error copy), and always something to do next. */
export function recapSpeechFailureCopy(reason: RecapSpeechFailure): string {
  switch (reason) {
    case "not_configured":
      return "Reading a recap aloud is not available in this workspace yet.";
    case "empty":
      return "There's nothing in that recap to read yet.";
    case "too_long":
      return "That recap is too long to read aloud. You can still read it below.";
    case "timeout":
      return "Reading that recap took too long. Try again.";
    default:
      return "Reading a recap is unavailable right now. Try again in a moment.";
  }
}

export async function synthesizeRecapSpeech(input: {
  lines: RecapSpeechLine[];
  voice: string;
  fetchImpl?: typeof fetch;
}): Promise<RecapSpeechResult> {
  const key = process.env.FAL_API_KEY?.trim();
  if (!key) return { ok: false, reason: "not_configured" };
  if (!input.lines.length || input.lines.every((line) => !line.text.trim())) {
    return { ok: false, reason: "empty" };
  }
  // Sentences, not a concatenation: each line's own final punctuation is
  // replaced by the join's, so the voice never hears a doubled stop. The words
  // themselves are untouched — this string is the provider's transcript only.
  const spoken = input.lines
    .map((line) => line.text.replace(/[.!?]+$/, ""))
    .join(". ")
    .concat(".");
  if (!spoken) return { ok: false, reason: "empty" };
  if (spoken.length > RECAP_SPEECH_MAX_CHARS) return { ok: false, reason: "too_long" };

  const call = input.fetchImpl ?? fetch;
  const voice = RECAP_VOICES.includes(input.voice as (typeof RECAP_VOICES)[number])
    ? input.voice
    : DEFAULT_RECAP_VOICE;

  let response: Response;
  try {
    response = await call(PROVIDER_URL, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: spoken, voice, style_instructions: RECAP_STYLE_INSTRUCTIONS }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "provider_error" };
  }

  const body = await response.json().catch(() => null) as
    | { audio?: { url?: unknown }; audio_url?: unknown; url?: unknown }
    | null;
  if (!response.ok) return { ok: false, reason: "provider_error" };
  const audioUrl = body?.audio?.url ?? body?.audio_url ?? body?.url;
  if (typeof audioUrl !== "string" || !audioUrl) return { ok: false, reason: "malformed" };

  try {
    const audio = await call(audioUrl, { cache: "no-store" });
    if (!audio.ok) return { ok: false, reason: "provider_error" };
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (!bytes.byteLength) return { ok: false, reason: "malformed" };
    return { ok: true, audio: bytes, mimeType: audio.headers.get("content-type") ?? "audio/wav", voice };
  } catch {
    return { ok: false, reason: "provider_error" };
  }
}

/** Failures are never cached: the next press must be able to reach the provider
 * again once the account, the network, or the recap itself has changed. */
const CACHE_LIMIT = 32;
const cache = new Map<string, RecapSpeechResult & { ok: true }>();

export function __resetRecapSpeechCache() {
  cache.clear();
}

export async function speakRecap(input: {
  intervalId: string;
  revision: number;
  voice: string;
  lines: RecapSpeechLine[];
  fetchImpl?: typeof fetch;
}): Promise<RecapSpeechResult> {
  const key = `${input.intervalId}:${input.revision}:${input.voice}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await synthesizeRecapSpeech(input);
  if (result.ok) {
    cache.set(key, result);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  return result;
}
