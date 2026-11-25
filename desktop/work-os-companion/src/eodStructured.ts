/* The desktop companion's structured EOD selection and save helpers.
 *
 * The composition contract, normalization and signatures live in
 * `@wrazy/work-os-shared/eod-structured`, the same module the web app uses.
 * Only companion-specific orchestration stays here.
 */

import {
  EOD_STRUCTURED_VERSION,
  cleanEodText,
  eodCompositionIsComplete,
  eodCompositionSignature,
  eodSummaryIsCurrent,
  normalizeEodStructuredReport,
  type EodStructuredReport,
} from "@wrazy/work-os-shared/eod-structured";

export {
  EOD_MAX_LINE_CHARS,
  EOD_MAX_LINES,
  EOD_STRUCTURED_VERSION,
  cleanEodLines,
  cleanEodText,
  eodCompositionIsComplete,
  eodCompositionSignature,
  eodSummaryIsCurrent,
  normalizeEodStructuredReport,
  normalizeLoomShareUrl,
} from "@wrazy/work-os-shared/eod-structured";
export type {
  EodCompositionInput,
  EodEvidenceGroup,
  EodEvidenceItem,
  EodStructuredReport,
  EodSuggestions,
} from "@wrazy/work-os-shared/eod-structured";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The card and footer state machine. `writing` is a transient UI state; the
 * persisted state is derived only from the composition and its signature. */
export function eodSummaryMode(
  input: Pick<EodStructuredReport, "summary" | "summarySignature" | "completed" | "inProgress" | "next"> & { writing?: boolean },
): "empty" | "ready" | "writing" | "stale" | "done" {
  if (input.writing) return "writing";
  if (cleanEodText(input.summary)) {
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
  return normalizeEodStructuredReport(value);
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
