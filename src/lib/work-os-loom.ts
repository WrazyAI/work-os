import { db, nonEmptyString, organizationOwnerId, type Json } from "@/lib/work-os-internal";

/** The org feature flag that gates Loom updates. */
export const LOOM_FEATURE_FLAG = "loom_updates";
/** Loom transcript stored with the check-in. Bounded so one long recording
 * cannot bloat the row; the AI receives a smaller slice. */
export const LOOM_TRANSCRIPT_MAX_STORED = 50_000;
export const LOOM_TRANSCRIPT_MAX_AI = 12_000;
export const LOOM_METADATA_TIMEOUT_MS = 8_000;
export const LOOM_METADATA_MAX_BYTES = 64_000;

const VIDEO_ID = /^[0-9a-f]{32}$/i;
const LOOM_HOSTS = new Set(["loom.com", "www.loom.com"]);
const VTT_TIMESTAMP = /^\s*(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}\s*-->/;
const VTT_HEADER = /^\s*(WEBVTT|NOTE|STYLE|REGION)\b.*$/i;
const SRT_INDEX = /^\s*\d{1,6}\s*$/;

export interface LoomReference {
  videoId: string;
  /** Canonical share URL; never the raw pasted text. */
  url: string;
}

export interface LoomMetadata {
  title: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

export interface LoomAttachment extends LoomReference, LoomMetadata {
  metadataSource: "oembed" | "unavailable";
  transcript: string | null;
  transcriptSource: "employee_paste" | null;
  transcriptChars: number;
  digest: string | null;
}

/** Accepts only https Loom share/embed URLs (or a bare 32-hex video id) and
 * returns the canonical reference. Deliberately strict: this value later
 * drives a server-side fetch, so userinfo, ports, lookalike hosts, and
 * non-https schemes are all rejected. */
export function parseLoomReference(value: string): LoomReference | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return { videoId: raw.toLowerCase(), url: `https://www.loom.com/share/${raw.toLowerCase()}` };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  if (!LOOM_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const match = parsed.pathname.match(/^\/(?:share|embed)\/([0-9a-f]{32})(?:\/)?$/i);
  if (!match) return null;
  const videoId = match[1].toLowerCase();
  return { videoId, url: `https://www.loom.com/share/${videoId}` };
}

/** Finds the first Loom link inside free text so a link pasted into the
 * ordinary update box still enriches. Only full URLs are detected here. */
export function findLoomReference(text: string): LoomReference | null {
  const candidates = text.match(/https:\/\/[^\s<>"']+/gi) ?? [];
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

/** Public metadata only, through Loom's official oEmbed endpoint. Never
 * throws: an unreachable or private video degrades to `null` and the update
 * still records with `metadataSource: "unavailable"`. */
export async function fetchLoomMetadata(reference: LoomReference): Promise<LoomMetadata | null> {
  const cached = metadataCache.get(reference.videoId);
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.value;
  let value: LoomMetadata | null = null;
  try {
    const response = await fetch(`https://www.loom.com/v1/oembed?url=${encodeURIComponent(reference.url)}&format=json`, {
      signal: AbortSignal.timeout(LOOM_METADATA_TIMEOUT_MS),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const body = await response.text();
      if (body.length <= LOOM_METADATA_MAX_BYTES) {
        const payload = JSON.parse(body) as { title?: unknown; duration?: unknown; thumbnail_url?: unknown };
        const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim().slice(0, 200) : null;
        const duration = Number(payload.duration);
        const thumbnailUrl = typeof payload.thumbnail_url === "string" && /^https:\/\/[^\s]+$/i.test(payload.thumbnail_url)
          ? payload.thumbnail_url.slice(0, 500)
          : null;
        if (title || Number.isFinite(duration) || thumbnailUrl) {
          value = {
            title,
            durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
            thumbnailUrl,
          };
        }
      }
    }
  } catch {
    value = null;
  }
  if (metadataCache.size >= METADATA_CACHE_MAX) metadataCache.clear();
  metadataCache.set(reference.videoId, { at: Date.now(), value });
  return value;
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

export interface LoomAttachmentInput {
  url: string;
  transcript?: string | null;
}

/** Resolves the employee's paste into a stored attachment: canonical link,
 * official metadata, normalized transcript. Never throws on enrichment
 * failure — metadata simply reads as unavailable. */
export async function resolveLoomAttachment(input: LoomAttachmentInput): Promise<{ attachment: LoomAttachment; reference: LoomReference } | null> {
  const reference = parseLoomReference(input.url);
  if (!reference) return null;
  const metadata = await fetchLoomMetadata(reference);
  const transcript = normalizeLoomTranscript(String(input.transcript ?? ""));
  return {
    reference,
    attachment: {
      ...reference,
      title: metadata?.title ?? null,
      durationSeconds: metadata?.durationSeconds ?? null,
      thumbnailUrl: metadata?.thumbnailUrl ?? null,
      metadataSource: metadata ? "oembed" : "unavailable",
      transcript: transcript || null,
      transcriptSource: transcript ? "employee_paste" : null,
      transcriptChars: transcript.length,
      digest: null,
    },
  };
}

/** The bounded text handed to the check-in AI, so proposals and the EOD draft
 * can use the recording without storing the transcript in the update body. */
export function loomAiContext(attachment: LoomAttachment): string {
  const facts = [
    `Loom recording: ${attachment.title ?? "Untitled"}`,
    formatLoomDuration(attachment.durationSeconds) ? `Duration: ${formatLoomDuration(attachment.durationSeconds)}` : null,
    attachment.url,
  ].filter(Boolean).join("\n");
  const transcript = attachment.transcript?.slice(0, LOOM_TRANSCRIPT_MAX_AI);
  return transcript ? `${facts}\nTranscript (pasted by the employee):\n${transcript}` : facts;
}

export function loomEvidenceTitle(attachment: LoomAttachment) {
  return `Loom update: ${attachment.title ?? "Untitled recording"}`;
}

/** Records the Loom artifact once per video: an evidence event plus its
 * mirrored evidence row, attributed to the posting employee. */
export async function recordLoomEvidence(input: {
  organizationId: string;
  personId: string;
  attachment: LoomAttachment;
  checkInId: string;
  occurredAt: string;
}) {
  const ownerId = await organizationOwnerId(input.organizationId);
  const now = new Date().toISOString();
  const summary = input.attachment.digest
    ?? input.attachment.transcript?.slice(0, 400)
    ?? "A Loom recording was attached to this day's update.";
  const metadata: Json = {
    videoId: input.attachment.videoId,
    durationSeconds: input.attachment.durationSeconds,
    thumbnailUrl: input.attachment.thumbnailUrl,
    transcriptChars: input.attachment.transcriptChars,
    transcriptSource: input.attachment.transcriptSource,
    metadataSource: input.attachment.metadataSource,
    checkInId: input.checkInId,
  };
  const { data: event, error: eventError } = await db()
    .from("work_evidence_events")
    .upsert({
      organization_id: input.organizationId,
      provider: "loom",
      external_event_id: input.attachment.videoId,
      event_type: "loom.update",
      evidence_class: "output_evidence",
      person_id: input.personId,
      task_id: null,
      attribution_method: "employee_paste",
      attribution_confidence: 1,
      title: loomEvidenceTitle(input.attachment),
      summary,
      artifact_url: input.attachment.url,
      occurred_at: input.occurredAt,
      metadata,
      raw: { loomUrl: input.attachment.url, checkInId: input.checkInId },
      updated_at: now,
    }, { onConflict: "organization_id,provider,external_event_id" })
    .select("*")
    .single();
  if (eventError) throw new Error(`record Loom evidence: ${eventError.message}`);
  // work_evidence carries only a partial unique index on evidence_event_id, so
  // ON CONFLICT cannot be used here — select then insert/update.
  const existing = await db().from("work_evidence").select("id")
    .eq("organization_id", input.organizationId).eq("evidence_event_id", event.id).maybeSingle();
  if (existing.error) throw new Error(`load Loom evidence mirror: ${existing.error.message}`);
  const mirror = {
    user_id: ownerId,
    organization_id: input.organizationId,
    person_id: input.personId,
    evidence_event_id: event.id,
    evidence_date: input.occurredAt.slice(0, 10),
    source: "loom",
    title: loomEvidenceTitle(input.attachment),
    summary,
    url: input.attachment.url,
    metrics: {
      evidenceClass: "output_evidence",
      attributionMethod: "employee_paste",
      attributionConfidence: 1,
      durationSeconds: input.attachment.durationSeconds,
      thumbnailUrl: input.attachment.thumbnailUrl,
      transcriptSource: input.attachment.transcriptSource,
    },
    raw: { evidenceEventId: event.id, checkInId: input.checkInId },
    updated_at: now,
  };
  const { error: mirrorError } = existing.data
    ? await db().from("work_evidence").update(mirror).eq("id", existing.data.id)
    : await db().from("work_evidence").insert(mirror);
  if (mirrorError) throw new Error(`mirror Loom evidence: ${mirrorError.message}`);
  return event;
}
