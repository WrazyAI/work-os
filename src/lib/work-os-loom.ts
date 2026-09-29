import { localDateForTimezone } from "@/modules/work-os/companion";
import { nonEmptyString } from "@/lib/work-os-internal";

/** The org feature flag that gates Loom analysis. */
export const LOOM_FEATURE_FLAG = "loom_updates";
/** Transcript stored with a recording. Bounded so one long recording cannot
 * bloat a request; the analysis receives a smaller slice. */
export const LOOM_TRANSCRIPT_MAX_STORED = 50_000;
export const LOOM_TRANSCRIPT_MAX_AI = 12_000;
export const LOOM_METADATA_TIMEOUT_MS = 8_000;
export const LOOM_METADATA_MAX_BYTES = 64_000;
export const LOOM_PAGE_MAX_BYTES = 400_000;
/** The recording's own caption track is fetched from Loom's CDN; bound the
 * payload and the wait so one long recording cannot stall an interpretation. */
export const LOOM_TRANSCRIPT_TIMEOUT_MS = 12_000;
export const LOOM_TRANSCRIPT_FETCH_MAX_BYTES = 2_000_000;

const VIDEO_ID = /^[0-9a-f]{32}$/i;
const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);
const LOOM_CDN_HOSTS = new Set(["cdn.loom.com"]);
const LOOM_IN_TEXT = /(?<![a-z0-9.-])(?:https?:\/\/)?(?:www\.)?loom\.com\/[^\s<>"']+/gi;
const VTT_TIMESTAMP = /^\s*(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}\s*-->/;
const VTT_HEADER = /^\s*(WEBVTT|NOTE|STYLE|REGION)\b.*$/i;
const SRT_INDEX = /^\s*\d{1,6}\s*$/;
const UPLOAD_DATE = /"uploadDate"\s*:\s*"([^"]+)"/;
const CREATED_AT = /"createdAt"\s*:\s*"([^"]+)"/;

export interface LoomReference {
  videoId: string;
  /** Canonical share URL; never the raw pasted text. */
  url: string;
}

export interface LoomMetadata {
  title: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  /** Public recording time from the share page; null when Loom does not
   * expose it (private or metadata-less recordings). */
  createdAt: string | null;
}

/** Where an analyzed transcript came from. Provenance is named in the prompt,
 * so the model never presents a pasted or auto-read transcript as something it
 * inferred. */
export type LoomTranscriptSource = "employee_paste" | "loom" | "update_text";

/** Loom's own transcription record from the public share page: the processing
 * status plus the signed transcript/caption URLs on cdn.loom.com. The URLs
 * expire, so they are used once and never stored. */
export interface LoomTranscriptRecord {
  status: string | null;
  sourceUrl: string | null;
  captionsUrl: string | null;
}

export type LoomTemporalVerdict = "same_day" | "prior_day" | "future" | "unknown";

export interface LoomTemporal {
  verdict: LoomTemporalVerdict;
  createdAt: string | null;
  createdLocalDate: string | null;
  targetDate: string;
  timezone: string;
}

/** Accepts Loom share/embed references and returns the canonical https
 * reference: a bare 32-hex video id, an `https` link, an `http` link (upgraded,
 * since every fetch is https-only), or the same link pasted without a scheme.
 * Deliberately strict everywhere else: this value later drives a server-side
 * fetch, so userinfo, ports, lookalike hosts, and non-Loom paths are rejected. */
export function parseLoomReference(value: string): LoomReference | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return { videoId: raw.toLowerCase(), url: `https://www.loom.com/share/${raw.toLowerCase()}` };
  // People paste "www.loom.com/share/..." or "loom.com/share/..." constantly.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "https:" && scheme !== "http:") return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  if (!LOOM_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const match = parsed.pathname.match(/^\/(?:share|embed)\/([0-9a-f]{32})(?:\/)?$/i);
  if (!match) return null;
  const videoId = match[1].toLowerCase();
  return { videoId, url: `https://www.loom.com/share/${videoId}` };
}

/** Finds the first Loom reference inside free text so a link pasted into an
 * ordinary update still reaches the analyze tool, with or without a scheme. */
export function findLoomReference(text: string): LoomReference | null {
  const candidates = [
    ...(String(text ?? "").match(LOOM_IN_TEXT) ?? []),
    ...(String(text ?? "").match(/https:\/\/[^\s<>"']+/gi) ?? []),
  ];
  for (const candidate of candidates) {
    const reference = parseLoomReference(candidate.replace(/[),.;!?]+$/, ""));
    if (reference) return reference;
  }
  return null;
}

export function loomMetadataEnabled(featureFlags: Record<string, boolean> | null | undefined) {
  return featureFlags?.[LOOM_FEATURE_FLAG] === true;
}

const metadataCache = new Map<string, { at: number; value: LoomMetadata | null }>();
const METADATA_TTL_MS = 5 * 60_000;
const METADATA_CACHE_MAX = 200;
/** A transcription still being processed is re-read quickly so a fresh
 * recording starts using its own transcript as soon as Loom finishes. */
const PAGE_TRANSCRIPT_RETRY_TTL_MS = 30_000;

function stringOrNull(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Reads one string value out of the share page's embedded JSON. */
function pageJsonString(html: string, key: string): string | null {
  const match = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
  return match && match[1].trim() ? match[1].trim() : null;
}

/** Only Loom's own CDN may be fetched, even though the URL came out of Loom's
 * page: same allow-list discipline the share link itself gets. */
function loomCdnUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !LOOM_CDN_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Reads Loom's own transcription record out of the public share page: the
 * processing status plus the signed JSON/VTT URLs when a transcript exists.
 * Pure, so the record shape and the CDN allow-list stay unit-testable. */
export function parseLoomTranscriptRecord(html: string): LoomTranscriptRecord | null {
  const status = pageJsonString(html, "transcription_status");
  const sourceUrl = loomCdnUrl(pageJsonString(html, "source_url"));
  const captionsUrl = loomCdnUrl(pageJsonString(html, "captions_source_url"));
  if (!status && !sourceUrl && !captionsUrl) return null;
  return { status, sourceUrl, captionsUrl };
}

/** Flattens Loom's JSON transcript (one `value` string per phrase) into a
 * single readable block, bounded like a pasted transcript. */
export function loomTranscriptTextFromJson(payload: unknown): string {
  const phrases = (payload as { phrases?: unknown } | null)?.phrases;
  if (!Array.isArray(phrases)) return "";
  const text = phrases
    .flatMap((phrase) => phrase && typeof phrase === "object" && typeof (phrase as { value?: unknown }).value === "string" ? [(phrase as { value: string }).value] : [])
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, LOOM_TRANSCRIPT_MAX_STORED);
}

const pageCache = new Map<string, { at: number; value: LoomSharePage | null }>();

interface LoomSharePage {
  createdAt: string | null;
  transcript: LoomTranscriptRecord | null;
}

/** Public metadata only, through Loom's official oEmbed endpoint plus the
 * public share page for the recording time. Never throws: an unreachable or
 * private video degrades to null and the caller decides. */
export async function fetchLoomMetadata(reference: LoomReference): Promise<LoomMetadata | null> {
  const cached = metadataCache.get(reference.videoId);
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.value;
  const [oembed, page] = await Promise.all([
    fetchLoomOembed(reference),
    fetchLoomSharePage(reference),
  ]);
  const createdAt = page?.createdAt ?? null;
  const value = oembed || createdAt
    ? {
        title: oembed?.title ?? null,
        durationSeconds: oembed?.durationSeconds ?? null,
        thumbnailUrl: oembed?.thumbnailUrl ?? null,
        createdAt,
      }
    : null;
  if (metadataCache.size >= METADATA_CACHE_MAX) metadataCache.clear();
  metadataCache.set(reference.videoId, { at: Date.now(), value });
  return value;
}

/** Reads a response body with a hard byte cap so a hostile or oversized
 * payload is never buffered. Returns null when the cap is exceeded. */
async function readBounded(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function fetchLoomOembed(reference: LoomReference): Promise<{ title: string | null; durationSeconds: number | null; thumbnailUrl: string | null } | null> {
  try {
    const response = await fetch(`https://www.loom.com/v1/oembed?url=${encodeURIComponent(reference.url)}&format=json`, {
      signal: AbortSignal.timeout(LOOM_METADATA_TIMEOUT_MS),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = await readBounded(response, LOOM_METADATA_MAX_BYTES);
    if (!body) return null;
    const payload = JSON.parse(body) as { title?: unknown; duration?: unknown; thumbnail_url?: unknown };
    const duration = Number(payload.duration);
    const thumbnail = stringOrNull(payload.thumbnail_url);
    const parsed = {
      title: stringOrNull(payload.title, 200),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      thumbnailUrl: thumbnail && /^https:\/\//i.test(thumbnail) ? thumbnail : null,
    };
    return parsed.title || parsed.durationSeconds || parsed.thumbnailUrl ? parsed : null;
  } catch {
    return null;
  }
}

/** The public share page carries the recording time as schema.org metadata
 * (`uploadDate`, sometimes `createdAt`) and, once Loom has transcribed the
 * recording, the signed transcript/captions record. Best-effort: null when the
 * page is unreachable or the recording is not public. Cached briefly so the
 * metadata and transcript reads share one page fetch. */
function pageCacheTtl(value: LoomSharePage | null) {
  return value?.transcript?.status === "success" ? METADATA_TTL_MS : PAGE_TRANSCRIPT_RETRY_TTL_MS;
}

async function fetchLoomSharePage(reference: LoomReference): Promise<LoomSharePage | null> {
  const cached = pageCache.get(reference.videoId);
  if (cached && Date.now() - cached.at < pageCacheTtl(cached.value)) return cached.value;
  let value: LoomSharePage | null = null;
  try {
    const response = await fetch(reference.url, {
      signal: AbortSignal.timeout(LOOM_METADATA_TIMEOUT_MS),
      redirect: "error",
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
    });
    if (response.ok) {
      const html = await readBounded(response, LOOM_PAGE_MAX_BYTES);
      if (html) {
        const match = html.match(UPLOAD_DATE) ?? html.match(CREATED_AT);
        const parsed = match ? new Date(match[1]) : null;
        value = {
          createdAt: parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null,
          transcript: parseLoomTranscriptRecord(html),
        };
      }
    }
  } catch {
    value = null;
  }
  if (pageCache.size >= METADATA_CACHE_MAX) pageCache.clear();
  pageCache.set(reference.videoId, { at: Date.now(), value });
  return value;
}

async function fetchLoomCdnBody(url: string, accept: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(LOOM_TRANSCRIPT_TIMEOUT_MS),
      redirect: "error",
      headers: { Accept: accept },
    });
    if (!response.ok) return null;
    return readBounded(response, LOOM_TRANSCRIPT_FETCH_MAX_BYTES);
  } catch {
    return null;
  }
}

/** Reads the recording's own transcript, so an employee never has to copy it:
 * Loom's transcript record points at a signed JSON/VTT pair on its CDN, and
 * only the normalized text leaves this function. Returns null when Loom has
 * not finished a transcript (or has none); the caller falls back to the
 * employee's paste. */
export async function fetchLoomTranscript(reference: LoomReference): Promise<{ text: string; source: "loom" } | null> {
  const page = await fetchLoomSharePage(reference);
  const record = page?.transcript;
  if (!record || (record.status && record.status !== "success")) return null;
  if (record.sourceUrl) {
    const body = await fetchLoomCdnBody(record.sourceUrl, "application/json");
    if (body) {
      try {
        const text = loomTranscriptTextFromJson(JSON.parse(body));
        if (text) return { text, source: "loom" };
      } catch {
        // Malformed JSON falls through to the caption track.
      }
    }
  }
  if (record.captionsUrl) {
    const body = await fetchLoomCdnBody(record.captionsUrl, "text/vtt");
    const text = body ? normalizeLoomTranscript(body) : "";
    if (text) return { text, source: "loom" };
  }
  return null;
}

/** Strips WebVTT/SRT scaffolding from a pasted transcript and collapses it to
 * a single readable block. Plain text passes through untouched. */
export function normalizeLoomTranscript(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (VTT_TIMESTAMP.test(line) || VTT_HEADER.test(line) || SRT_INDEX.test(line)) continue;
    const cleaned = line.replace(/<\/?[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned) kept.push(cleaned);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim().slice(0, LOOM_TRANSCRIPT_MAX_STORED);
}

export function formatLoomDuration(seconds: number | null | undefined): string | null {
  if (!Number.isFinite(seconds) || (seconds as number) <= 0) return null;
  const total = Math.round(seconds as number);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Compares the recording's local date with the day it is being used for.
 * Prior-day (and future-dated) recordings are not usable as that day's
 * update; an unknown date stays usable but must be labeled as unverified. */
export function loomTemporal(createdAt: string | null, targetDate: string, timezone: string): LoomTemporal {
  if (!createdAt) return { verdict: "unknown", createdAt: null, createdLocalDate: null, targetDate, timezone };
  const at = new Date(createdAt);
  if (!Number.isFinite(at.getTime())) return { verdict: "unknown", createdAt: null, createdLocalDate: null, targetDate, timezone };
  let createdLocalDate: string;
  try {
    createdLocalDate = localDateForTimezone(at, timezone);
  } catch {
    createdLocalDate = at.toISOString().slice(0, 10);
  }
  const verdict: LoomTemporalVerdict = createdLocalDate === targetDate
    ? "same_day"
    : createdLocalDate < targetDate ? "prior_day" : "future";
  return { verdict, createdAt: at.toISOString(), createdLocalDate, targetDate, timezone };
}

export interface LoomBundle {
  reference: LoomReference;
  metadata: LoomMetadata | null;
  temporal: LoomTemporal;
  transcript: { present: boolean; chars: number; source: LoomTranscriptSource | null; text: string | null };
}

/** Collects everything the analyze tool needs from one pasted link: canonical
 * reference, public metadata (including the recording time), the temporal
 * verdict for the target day, and the normalized transcript. An explicit
 * employee paste wins; otherwise the recording's own transcript is read from
 * Loom, so no copy step is required. Text merely written beside the link in a
 * chat update is only a fallback, never a reason to skip the recording's own
 * transcript. Already-refused days are not transcribed. Returns null only when
 * the link is not a Loom share link. */
export async function collectLoomBundle(input: {
  url: string;
  transcript?: string | null;
  /** Prose pasted alongside the link; used only when nothing better exists. */
  updateText?: string | null;
  targetDate: string;
  timezone: string;
}): Promise<LoomBundle | null> {
  const reference = parseLoomReference(input.url);
  if (!reference) return null;
  const pasted = normalizeLoomTranscript(String(input.transcript ?? ""));
  const inferred = pasted ? "" : normalizeLoomTranscript(String(input.updateText ?? ""));
  const metadata = await fetchLoomMetadata(reference);
  const temporal = loomTemporal(metadata?.createdAt ?? null, input.targetDate, input.timezone);
  const extracted = pasted || !loomUsableForDay(temporal) ? null : await fetchLoomTranscript(reference);
  const text = pasted || extracted?.text || inferred;
  return {
    reference,
    metadata,
    temporal,
    transcript: {
      present: !!text,
      chars: text.length,
      source: pasted ? "employee_paste" : extracted ? "loom" : inferred ? "update_text" : null,
      text: text || null,
    },
  };
}

/** True when the recording may be used for the target day at all. */
export function loomUsableForDay(temporal: LoomTemporal) {
  return temporal.verdict === "same_day" || temporal.verdict === "unknown";
}
