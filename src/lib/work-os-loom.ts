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

const VIDEO_ID = /^[0-9a-f]{32}$/i;
const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);
const LOOM_IN_TEXT = /(?:https?:\/\/)?(?:www\.)?loom\.com\/(?:share|embed)\/[0-9a-f]{32}/gi;
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

function stringOrNull(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Public metadata only, through Loom's official oEmbed endpoint plus the
 * public share page for the recording time. Never throws: an unreachable or
 * private video degrades to null and the caller decides. */
export async function fetchLoomMetadata(reference: LoomReference): Promise<LoomMetadata | null> {
  const cached = metadataCache.get(reference.videoId);
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.value;
  const [oembed, createdAt] = await Promise.all([
    fetchLoomOembed(reference),
    fetchLoomCreatedAt(reference),
  ]);
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
 * (`uploadDate`, sometimes `createdAt`). Best-effort: null when the page is
 * unreachable or the recording is not public. */
async function fetchLoomCreatedAt(reference: LoomReference): Promise<string | null> {
  try {
    const response = await fetch(reference.url, {
      signal: AbortSignal.timeout(LOOM_METADATA_TIMEOUT_MS),
      redirect: "error",
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
    });
    if (!response.ok) return null;
    const html = await readBounded(response, LOOM_PAGE_MAX_BYTES);
    if (!html) return null;
    const match = html.match(UPLOAD_DATE) ?? html.match(CREATED_AT);
    if (!match) return null;
    const parsed = new Date(match[1]);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  } catch {
    return null;
  }
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
  transcript: { present: boolean; chars: number; source: "employee_paste" | null; text: string | null };
}

/** Collects everything the analyze tool needs from one pasted link: canonical
 * reference, public metadata (including the recording time), the temporal
 * verdict for the target day, and the normalized transcript. Returns null only
 * when the link itself is not a Loom share link. */
export async function collectLoomBundle(input: {
  url: string;
  transcript?: string | null;
  targetDate: string;
  timezone: string;
}): Promise<LoomBundle | null> {
  const reference = parseLoomReference(input.url);
  if (!reference) return null;
  const [metadata, transcript] = await Promise.all([
    fetchLoomMetadata(reference),
    Promise.resolve(normalizeLoomTranscript(String(input.transcript ?? ""))),
  ]);
  return {
    reference,
    metadata,
    temporal: loomTemporal(metadata?.createdAt ?? null, input.targetDate, input.timezone),
    transcript: {
      present: !!transcript,
      chars: transcript.length,
      source: transcript ? "employee_paste" : null,
      text: transcript || null,
    },
  };
}

/** True when the recording may be used for the target day at all. */
export function loomUsableForDay(temporal: LoomTemporal) {
  return temporal.verdict === "same_day" || temporal.verdict === "unknown";
}
