/* The desktop companion's copy of the structured EOD contract.
 *
 * Types stay type-only against the web module. The four runtime helpers are
 * deliberately mirrored so the companion bundle never imports server-adjacent
 * web code; `eodStructured.test.ts` pins the mirror to the web behavior.
 */

export type {
  EodCompositionInput,
  EodEvidenceGroup,
  EodEvidenceItem,
  EodStructuredReport,
  EodSuggestions,
} from "../../../src/modules/work-os/eod-structured";

import type {
  EodCompositionInput,
  EodEvidenceGroup,
  EodEvidenceItem,
  EodStructuredReport,
  EodSuggestions,
} from "../../../src/modules/work-os/eod-structured";

export const EOD_STRUCTURED_VERSION = 1;
const EOD_MAX_LINES = 12;
const EOD_MAX_LINE_CHARS = 240;
const EOD_MAX_SUMMARY_CHARS = 4_000;
const EOD_MAX_SUGGESTIONS = 5;
const EOD_MAX_EVIDENCE_GROUPS = 10;
const EOD_MAX_EVIDENCE_ITEMS = 24;
const EOD_MAX_URL_CHARS = 800;
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
  return {
    id: cleanEodText(row.id, 160) || `item-${index + 1}`,
    title,
    summary: cleanEodText(row.summary, 600) || null,
    meta: cleanEodText(row.meta, 240) || null,
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
  return value.summarySignature === eodCompositionSignature(value);
}

/** The card and footer state machine. `writing` is a transient UI state; the
 * persisted state is derived only from the composition and its signature. */
export function eodSummaryMode(
  input: Pick<EodStructuredReport, "summary" | "summarySignature" | "completed" | "inProgress" | "next"> & { writing?: boolean },
): "empty" | "ready" | "writing" | "stale" | "done" {
  if (input.writing) return "writing";
  if (cleanEodText(input.summary, EOD_MAX_SUMMARY_CHARS)) {
    return eodSummaryIsCurrent(input) ? "done" : "stale";
  }
  return eodCompositionIsComplete(input) ? "ready" : "empty";
}

/** A version-1 payload is the structured composer's contract. Anything else
 * (a historical markdown draft, a submitted legacy report, or a malformed
 * payload) must stay on the legacy editor. */
export function eodStructuredFromReport(report: unknown): EodStructuredReport | null {
  const value = asRecord(asRecord(report).structured_report);
  if (Number(value.version) !== EOD_STRUCTURED_VERSION) return null;
  const source = String(value.source ?? "");
  return {
    version: EOD_STRUCTURED_VERSION,
    summary: cleanEodText(value.summary, EOD_MAX_SUMMARY_CHARS),
    summaryGeneratedAt: cleanIso(value.summaryGeneratedAt),
    summarySource: value.summarySource === "otto" || value.summarySource === "assembled" ? value.summarySource : null,
    summarySignature: cleanEodText(value.summarySignature, 80) || null,
    completed: cleanEodLines(value.completed),
    inProgress: cleanEodLines(value.inProgress),
    next: cleanEodLines(value.next),
    suggestions: cleanSuggestions(value.suggestions),
    evidence: cleanEvidence(value.evidence),
    loomUrl: normalizeLoomShareUrl(value.loomUrl),
    preparedAt: cleanIso(value.preparedAt),
    source: source === "scheduled" || source === "employee" || source === "admin" ? source : null,
  };
}

export type SaveFlightResult = "started" | "deferred";

/** One save at a time, with the newest snapshot queued behind it. A second
 * call while a save is in flight is deferred and replayed once, not dropped. */
export function createSaveFlight<T>(save: (value: T) => Promise<void>) {
  let inFlight = false;
  let pending: T | null = null;
  let chain: Promise<void> = Promise.resolve();
  const run = async (value: T): Promise<void> => {
    inFlight = true;
    try {
      await save(value);
    } finally {
      inFlight = false;
      if (pending !== null) {
        const next = pending;
        pending = null;
        chain = run(next);
        await chain;
      }
    }
  };
  return async (value: T): Promise<SaveFlightResult> => {
    if (inFlight) {
      pending = value;
      return "deferred";
    }
    chain = run(value);
    await chain;
    return "started";
  };
}

/** A save failure keeps the employee's text; a server conflict message is
 * preserved so "reload before editing again" is not replaced by a generic
 * failure. */
export function saveFailureNotice(error: unknown): { tone: "error"; text: string; conflict: boolean } {
  const status = typeof (error as { status?: unknown } | null)?.status === "number"
    ? (error as { status: number }).status
    : null;
  return {
    tone: "error",
    text: error instanceof Error && error.message.trim()
      ? error.message
      : "Your draft was not saved. Your text is still here.",
    conflict: status === 409,
  };
}

/** Only today's unsubmitted draft is silently prepared. A rejected or
 * submitted report already carries a manager decision and must never be
 * rewritten back to draft by opening the companion. */
export function shouldPrepareStructuredEod(report: unknown, currentDate: string | null): boolean {
  if (!currentDate) return false;
  const row = asRecord(report);
  if (row.status !== "draft" || row.submitted_at) return false;
  if (eodStructuredFromReport(report)) return false;
  return String(row.report_date ?? "").slice(0, 10) === currentDate;
}
