/* The structured EOD contract.
 *
 * The deterministic report remains the full record. This module owns only the
 * employee's composition: three short sections, the generated summary, the
 * server-prepared suggestions and evidence snapshot, and the optional Loom
 * link. It is shared by the server, the web composer and the admin review so
 * validation and staleness mean the same thing everywhere.
 *
 * Nothing here calls a model or touches the database. Keep it safe to import
 * from a client component.
 */

export const EOD_STRUCTURED_VERSION = 1;
export const EOD_MAX_LINES = 12;
export const EOD_MAX_LINE_CHARS = 240;
export const EOD_MAX_SUMMARY_CHARS = 4_000;
export const EOD_MAX_SUGGESTIONS = 5;
export const EOD_MAX_EVIDENCE_GROUPS = 10;
export const EOD_MAX_EVIDENCE_ITEMS = 24;
export const EOD_MAX_URL_CHARS = 800;

export type EodSectionKey = "completed" | "inProgress" | "next";

export interface EodSuggestions {
  completed: string[];
  inProgress: string[];
  next: string[];
}

export interface EodEvidenceItem {
  id: string;
  title: string;
  summary: string | null;
  meta: string | null;
  url: string | null;
  at: string | null;
  kind: string | null;
}

export interface EodEvidenceGroup {
  /** Stable source key used by the source icon map: tasks, worktivity,
   * github, loom, docs, calendar, ghl, or another provider key. */
  source: string;
  label: string;
  items: EodEvidenceItem[];
}

export interface EodStructuredReport {
  version: typeof EOD_STRUCTURED_VERSION;
  summary: string;
  summaryGeneratedAt: string | null;
  /** Whether the model wrote it or the server assembled a fallback from the
   * employee's lines. The UI must not call a fallback "Otto". */
  summarySource: "otto" | "assembled" | null;
  /** The composition the summary was written for. A mismatch means the
   * summary is stale and must be regenerated before submission. */
  summarySignature: string | null;
  completed: string[];
  inProgress: string[];
  next: string[];
  suggestions: EodSuggestions;
  evidence: EodEvidenceGroup[];
  loomUrl: string | null;
  preparedAt: string | null;
  source: "scheduled" | "employee" | "admin" | null;
}

export interface EodCompositionInput {
  summary?: unknown;
  summaryGeneratedAt?: unknown;
  summarySource?: unknown;
  summarySignature?: unknown;
  completed?: unknown;
  inProgress?: unknown;
  next?: unknown;
  loomUrl?: unknown;
}

const LOOM_ID = /^[0-9a-f]{32}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function cleanEodText(value: unknown, max = EOD_MAX_LINE_CHARS): string {
  return String(typeof value === "string" ? value : "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** One field is a short list of independently reviewable lines. Empty and
 * duplicate lines are dropped, case-insensitively, before anything is stored
 * or signed. */
export function cleanEodLines(value: unknown, max = EOD_MAX_LINES): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of value) {
    const text = cleanEodText(item, EOD_MAX_LINE_CHARS);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(text);
    if (lines.length >= max) break;
  }
  return lines;
}

function cleanIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** Accepts the Loom share forms employees actually paste and returns the
 * canonical https share URL. Kept deliberately strict; this value is rendered
 * as a link and sent to Loom when a later pass analyses it. */
export function normalizeLoomShareUrl(value: unknown): string | null {
  const raw = cleanEodText(value, EOD_MAX_URL_CHARS);
  if (!raw) return null;
  if (LOOM_ID.test(raw)) return `https://www.loom.com/share/${raw.toLowerCase()}`;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol.toLowerCase())) return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  if (!["loom.com", "www.loom.com"].includes(parsed.hostname.toLowerCase())) return null;
  const match = parsed.pathname.match(/^\/(?:share|embed)\/([0-9a-f]{32})(?:\/)?$/i);
  if (!match) return null;
  return `https://www.loom.com/share/${match[1].toLowerCase()}`;
}

function cleanUrl(value: unknown): string | null {
  const raw = cleanEodText(value, EOD_MAX_URL_CHARS);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function cleanEvidenceItem(value: unknown, index: number): EodEvidenceItem | null {
  const row = asRecord(value);
  const title = cleanEodText(row.title, 240);
  if (!title) return null;
  const summary = cleanEodText(row.summary, 600) || null;
  const meta = cleanEodText(row.meta, 240) || null;
  return {
    id: cleanEodText(row.id, 160) || `item-${index + 1}`,
    title,
    summary,
    meta,
    url: cleanUrl(row.url),
    at: cleanIso(row.at),
    kind: cleanEodText(row.kind, 48) || null,
  };
}

function cleanEvidenceGroup(value: unknown, index: number): EodEvidenceGroup | null {
  const row = asRecord(value);
  const source = cleanEodText(row.source, 48).toLowerCase() || `source-${index + 1}`;
  const label = cleanEodText(row.label, 80) || source;
  const items = Array.isArray(row.items)
    ? row.items.map((item, itemIndex) => cleanEvidenceItem(item, itemIndex)).filter((item): item is EodEvidenceItem => Boolean(item)).slice(0, EOD_MAX_EVIDENCE_ITEMS)
    : [];
  if (!items.length) return null;
  return { source, label, items };
}

function cleanEvidence(value: unknown): EodEvidenceGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((group, index) => cleanEvidenceGroup(group, index))
    .filter((group): group is EodEvidenceGroup => Boolean(group))
    .slice(0, EOD_MAX_EVIDENCE_GROUPS);
}

function cleanSuggestions(value: unknown): EodSuggestions {
  const row = asRecord(value);
  return {
    completed: cleanEodLines(row.completed, EOD_MAX_SUGGESTIONS),
    inProgress: cleanEodLines(row.inProgress, EOD_MAX_SUGGESTIONS),
    next: cleanEodLines(row.next, EOD_MAX_SUGGESTIONS),
  };
}

/** The exact composition a summary was written for. The client computes it
 * before regenerating; the server recomputes it before submission. */
export function eodCompositionSignature(input: {
  completed: unknown;
  inProgress: unknown;
  next: unknown;
}): string {
  const serialized = JSON.stringify({
    completed: cleanEodLines(input.completed),
    inProgress: cleanEodLines(input.inProgress),
    next: cleanEodLines(input.next),
  });
  // A short, stable fingerprint keeps the stored signature bounded even when
  // permitted lines contain escaped quotes or backslashes. This is a staleness
  // check, not an authentication token.
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2654435761);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function eodCompositionIsComplete(value: Pick<EodStructuredReport, "completed" | "inProgress" | "next">): boolean {
  return cleanEodLines(value.completed).length > 0
    && cleanEodLines(value.inProgress).length > 0
    && cleanEodLines(value.next).length > 0;
}

export function eodSummaryIsCurrent(value: Pick<EodStructuredReport, "summary" | "summarySignature" | "completed" | "inProgress" | "next">): boolean {
  if (!cleanEodText(value.summary, EOD_MAX_SUMMARY_CHARS)) return false;
  const signature = eodCompositionSignature(value);
  return value.summarySignature === signature;
}

export function eodEvidenceCount(groups: EodEvidenceGroup[] | null | undefined): number {
  return (groups ?? []).reduce((total, group) => total + group.items.length, 0);
}

export function normalizeEodStructuredReport(value: unknown): EodStructuredReport {
  const row = asRecord(value);
  const summary = cleanEodText(row.summary, EOD_MAX_SUMMARY_CHARS);
  const completed = cleanEodLines(row.completed);
  const inProgress = cleanEodLines(row.inProgress);
  const next = cleanEodLines(row.next);
  const source = row.source === "scheduled" || row.source === "employee" || row.source === "admin" ? row.source : null;
  return {
    version: EOD_STRUCTURED_VERSION,
    summary,
    summaryGeneratedAt: cleanIso(row.summaryGeneratedAt),
    summarySource: row.summarySource === "otto" || row.summarySource === "assembled" ? row.summarySource : null,
    // An absent signature is deliberately preserved. It means the summary was
    // written before signatures existed (or was imported), so the UI treats it
    // as stale rather than silently claiming it matches the current lines.
    summarySignature: typeof row.summarySignature === "string" && row.summarySignature.trim()
      ? row.summarySignature.trim().slice(0, 16_000)
      : null,
    completed,
    inProgress,
    next,
    suggestions: cleanSuggestions(row.suggestions),
    evidence: cleanEvidence(row.evidence),
    loomUrl: normalizeLoomShareUrl(row.loomUrl),
    preparedAt: cleanIso(row.preparedAt),
    source,
  };
}

/** Merges an employee save into the server-owned structure. Suggestions and
 * evidence stay server-owned; the client cannot replace them. */
export function mergeEodComposition(
  base: EodStructuredReport,
  input: EodCompositionInput,
): EodStructuredReport {
  const completed = input.completed === undefined ? base.completed : cleanEodLines(input.completed);
  const inProgress = input.inProgress === undefined ? base.inProgress : cleanEodLines(input.inProgress);
  const next = input.next === undefined ? base.next : cleanEodLines(input.next);
  const summary = input.summary === undefined ? base.summary : cleanEodText(input.summary, EOD_MAX_SUMMARY_CHARS);
  return {
    ...base,
    summary,
    summaryGeneratedAt: input.summaryGeneratedAt === undefined
      ? base.summaryGeneratedAt
      : cleanIso(input.summaryGeneratedAt),
    summarySource: input.summarySource === undefined
      ? base.summarySource
      : input.summarySource === "otto" || input.summarySource === "assembled"
        ? input.summarySource
        : null,
    summarySignature: input.summarySignature === undefined
      ? base.summarySignature
      : typeof input.summarySignature === "string" && input.summarySignature.trim()
        ? input.summarySignature.trim().slice(0, 16_000)
        : null,
    completed,
    inProgress,
    next,
    loomUrl: input.loomUrl === undefined ? base.loomUrl : normalizeLoomShareUrl(input.loomUrl),
  };
}

export function emptyEodStructuredReport(): EodStructuredReport {
  return normalizeEodStructuredReport({});
}

/** A deterministic, honest opener when the summary model is unavailable. It
 * uses only the employee's own lines; the UI labels it as assembled. */
export function assembleEodSummary(input: Pick<EodStructuredReport, "completed" | "inProgress" | "next">): string {
  const first = input.completed[0];
  const progress = input.inProgress[0];
  const next = input.next[0];
  const parts: string[] = [];
  if (first) parts.push(`${first}.`);
  if (input.completed.length > 1) parts.push(`${input.completed[1]}.`);
  if (progress) parts.push(`${progress} is still in progress.`);
  if (next) parts.push(`Tomorrow starts with ${next.charAt(0).toLowerCase()}${next.slice(1)}.`);
  return parts.join(" ").trim();
}
