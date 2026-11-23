import {
  intersectSpans, subtractSpans, unionSpans,
} from "@/lib/work-os-payroll-intervals";
import type {
  Category, FindingDecision, PayrollCitation, PayrollDayInput, PayrollDayResult,
  PayrollFinding, PayrollFindingEffect, PayrollFindingKind, PayrollFindingStatus, PayrollTotals, Span,
} from "@/modules/work-os/payroll/contracts";

const CATEGORIES: Category[] = ["payable", "break", "inactivity", "held", "manual", "outside"];
const ZERO = (): Record<Category, number> => ({ payable: 0, break: 0, inactivity: 0, held: 0, manual: 0, outside: 0 });
const MINUTE = 60_000;
const GAP_FLAG_MS = 5 * MINUTE;
const LOW_EVIDENCE_RATIO = 0.2;
const LOW_EVIDENCE_CONTINUOUS_MS = 30 * MINUTE;
const INACTIVITY_THRESHOLD_MS = 180_000;
const CONFIDENCE_FLOOR = 0.6;
const MINUTE_ORDER: Category[] = ["payable", "break", "inactivity", "held", "manual", "outside"];

type Part = { span: Span; category: Category; findingKey: string | null };

function duration(spans: Span[]): number {
  return spans.reduce((sum, span) => sum + span.endMs - span.startMs, 0);
}
function validSpan(span: Span | null): span is Span {
  return !!span && Number.isSafeInteger(span.startMs) && Number.isSafeInteger(span.endMs) && span.endMs > span.startMs;
}
function assertInput(input: PayrollDayInput): void {
  if (!input.sourceHash.trim()) throw new Error("A payroll day requires a source hash");
  if (!Number.isSafeInteger(input.pauseResidualMs) || input.pauseResidualMs < 0) {
    throw new Error("Payroll pause residuals must be nonnegative integer milliseconds");
  }
  for (const session of input.sessions) {
    for (const span of [session.recorded, session.eligible]) if (span && !validSpan(span)) throw new Error("Payroll session span is invalid");
  }
  for (const capture of input.captures) if (capture.span && !validSpan(capture.span)) throw new Error("Payroll capture span is invalid");
  for (const span of input.breaks.map((item) => item.span)) if (!validSpan(span)) throw new Error("Payroll break span is invalid");
  for (const span of input.exceptions.map((item) => item.span)) if (!validSpan(span)) throw new Error("Payroll exception span is invalid");
  for (const signal of input.frameSignals ?? []) if (!validSpan(signal.span)) throw new Error("Payroll frame signal span is invalid");
}

function compact(parts: Part[]): Part[] {
  const sorted = parts.filter((part) => part.span.endMs > part.span.startMs)
    .map((part) => ({ ...part, span: { ...part.span } }))
    .sort((left, right) => left.span.startMs - right.span.startMs || left.span.endMs - right.span.endMs);
  const out: Part[] = [];
  for (const part of sorted) {
    const last = out[out.length - 1];
    if (last && last.category === part.category && last.findingKey === part.findingKey && part.span.startMs <= last.span.endMs) {
      last.span.endMs = Math.max(last.span.endMs, part.span.endMs);
    } else out.push(part);
  }
  return out;
}

/** Splits the covered part and replaces the overlap's category/key. The
 * predicate keeps late decisions from rewriting outside/break ownership. */
function applyZone(
  parts: Part[], zone: Span, category: Category, findingKey: string | null,
  predicate: (part: Part) => boolean = () => true,
): Part[] {
  const out: Part[] = [];
  for (const part of parts) {
    const overlap = intersectSpans([part.span], [zone])[0];
    if (!overlap || !predicate(part)) { out.push(part); continue; }
    if (part.span.startMs < overlap.startMs) out.push({ ...part, span: { startMs: part.span.startMs, endMs: overlap.startMs } });
    out.push({ span: overlap, category, findingKey });
    if (overlap.endMs < part.span.endMs) out.push({ ...part, span: { startMs: overlap.endMs, endMs: part.span.endMs } });
  }
  return compact(out);
}

function tagZone(parts: Part[], zone: Span, findingKey: string, predicate: (part: Part) => boolean): Part[] {
  return applyZone(parts, zone, "payable", findingKey, (part) => predicate(part) && part.category === "payable");
}

function partsOf(parts: Part[], category: Category): Span[] {
  return parts.filter((part) => part.category === category).map((part) => part.span);
}

function exactFrom(parts: Part[]): Record<Category, number> {
  const exact = ZERO();
  for (const part of parts) exact[part.category] += part.span.endMs - part.span.startMs;
  return exact;
}

/** Largest-remainder whole-day minute allocation. The target is the recorded
 * duration rounded half up; thresholds were evaluated before this call. */
export function allocatePayrollMinutes(exactMs: Record<Category, number>): Record<Category, number> {
  let total = 0;
  const floors = ZERO();
  const remainders = ZERO();
  for (const category of CATEGORIES) {
    const value = exactMs[category];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Payroll ${category} duration must be a finite nonnegative integer`);
    total += value;
    floors[category] = Math.floor(value / MINUTE);
    remainders[category] = value - floors[category] * MINUTE;
  }
  const target = Math.floor(total / MINUTE) + (total % MINUTE >= MINUTE / 2 ? 1 : 0);
  let residual = target - CATEGORIES.reduce((sum, category) => sum + floors[category], 0);
  const ordered = MINUTE_ORDER
    .filter((category) => remainders[category] > 0)
    .sort((left, right) => remainders[right] - remainders[left] || MINUTE_ORDER.indexOf(left) - MINUTE_ORDER.indexOf(right));
  const minutes = { ...floors };
  for (let index = 0; residual > 0 && index < ordered.length; index += 1, residual -= 1) {
    if (remainders[ordered[index]] > 0) minutes[ordered[index]] += 1;
  }
  if (residual !== 0) throw new Error("Payroll minute allocation did not converge");
  return minutes;
}

function totalsFrom(exactMs: Record<Category, number>): PayrollTotals {
  const minutes = allocatePayrollMinutes(exactMs);
  const eligibleTracked = minutes.payable + minutes.break + minutes.inactivity + minutes.held + minutes.manual;
  return {
    recorded: eligibleTracked + minutes.outside, eligibleTracked, outside: minutes.outside,
    break: minutes.break, inactivity: minutes.inactivity, held: minutes.held,
    manualExcluded: minutes.manual, recommended: minutes.payable, approved: 0,
  };
}

function finding(
  input: PayrollDayInput, key: string, kind: PayrollFindingKind, status: PayrollFindingStatus,
  effect: PayrollFindingEffect, span: Span | null, durationMs: number, reason: string,
  blocksApproval: boolean, requiredAction: PayrollFinding["requiredAction"], citations: PayrollCitation[] = [],
): PayrollFinding {
  return {
    id: key, key, scope: input.scope, dayId: "", date: input.date, kind, status, effect,
    span, durationMs, minutes: Math.round(durationMs / MINUTE), sourceHash: input.sourceHash,
    blocksApproval, requiredAction, reason, citations,
  };
}

function keysFor(date: string) {
  const used = new Map<string, number>();
  return (kind: string, span: Span | null) => {
    // Findings are stored by review revision, not only by day. A non-timed
    // finding must carry its owning date to stay independently resolvable.
    const base = `${kind}:${span ? `${span.startMs}-${span.endMs}` : `aggregate:${date}`}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}:${count}`;
  };
}

export function calculatePayrollDay(input: PayrollDayInput): PayrollDayResult {
  assertInput(input);
  const nextKey = keysFor(input.date);
  const findings: PayrollFinding[] = [];
  const derivedBlockers: string[] = [];
  const sessions = input.sessions;
  if (sessions.some((session) => !session.closed)) derivedBlockers.push("Open session requires clock-out or correction");
  const usableEligible = sessions.flatMap((session) => session.eligible ? [session.eligible] : []);
  const sessionRecorded = sessions.flatMap((session) => session.recorded ? [session.recorded] : []);
  if (!usableEligible.length && sessionRecorded.length) derivedBlockers.push("No eligible schedule is available for recorded work");
  for (let left = 0; left < sessionRecorded.length; left += 1) {
    for (let right = left + 1; right < sessionRecorded.length; right += 1) {
      if (intersectSpans([sessionRecorded[left]], [sessionRecorded[right]]).length) {
        derivedBlockers.push("Overlapping sessions require ownership reconciliation");
      }
    }
  }
  if (input.pauseResidualMs > 0) {
    const key = nextKey("break_mismatch", null);
    findings.push(finding(input, key, "break_mismatch", "needs_review", "acknowledge", null, input.pauseResidualMs,
      "An unlocated provider/manual break residual cannot be placed on the timeline; reconcile it before approval.", true, "acknowledge"));
  }
  const blockers = [...new Set([...input.blockers, ...derivedBlockers])];

  const captureSpans = input.captures.flatMap((capture) => capture.span ? [capture.span] : []);
  const tracked = intersectSpans(unionSpans([...sessionRecorded, ...captureSpans]), unionSpans(usableEligible));
  const outside = subtractSpans(unionSpans([...sessionRecorded, ...captureSpans]), unionSpans(usableEligible));
  let parts: Part[] = [
    ...tracked.map((span) => ({ span, category: "payable" as const, findingKey: null })),
    ...outside.map((span) => ({ span, category: "outside" as const, findingKey: null })),
  ];

  const breakSpans = intersectSpans(unionSpans(input.breaks.map((item) => item.span)), tracked);
  const activitySpans = unionSpans(input.captures
    .filter((capture) => capture.span && capture.activity !== null && capture.activity > 0)
    .map((capture) => capture.span!));
  const disputedBreaks = intersectSpans(breakSpans, activitySpans);
  const cleanBreaks = subtractSpans(breakSpans, disputedBreaks);
  for (const span of cleanBreaks) {
    const key = nextKey("break", span);
    parts = applyZone(parts, span, "break", key, (part) => part.category === "payable");
    findings.push(finding(input, key, "break", "auto_excluded", "exclude", span, span.endMs - span.startMs,
      "Recorded break time is unpaid and is excluded once.", false, "none"));
  }
  for (const span of disputedBreaks) {
    const key = nextKey("activity_during_break", span);
    parts = applyZone(parts, span, "held", key, (part) => part.category === "payable");
    findings.push(finding(input, key, "activity_during_break", "needs_review", "hold", span, span.endMs - span.startMs,
      "Recorded activity overlaps a scheduled or provider break; decide whether the break was worked.", true, "decide"));
  }

  const zeroSpans = unionSpans(input.captures
    .filter((capture) => capture.zeroEligible && capture.span)
    .map((capture) => capture.span!));
  const exceptions = input.exceptions.map((item) => item.span);
  const frameSignals = input.frameSignals ?? [];
  const payableSignals = unionSpans([
    ...exceptions,
    ...frameSignals.filter((signal) => ["meeting", "training", "reading", "work"].includes(signal.category) && signal.confidence >= CONFIDENCE_FLOOR)
      .map((signal) => signal.span),
  ]);
  const nonworkSignals = unionSpans(frameSignals
    .filter((signal) => signal.category === "nonwork" && signal.confidence >= CONFIDENCE_FLOOR)
    .map((signal) => signal.span));
  const contradictions = intersectSpans(payableSignals, nonworkSignals);
  const payableEvidence = subtractSpans(payableSignals, contradictions);
  const nonworkEvidence = subtractSpans(nonworkSignals, payableSignals);

  for (const run of zeroSpans) {
    for (const candidate of intersectSpans([run], partsOf(parts, "payable"))) {
      if (candidate.endMs - candidate.startMs < INACTIVITY_THRESHOLD_MS) continue;
      const payableZones = intersectSpans([candidate], payableEvidence);
      const nonworkZones = intersectSpans([candidate], nonworkEvidence);
      const contradictionZones = intersectSpans([candidate], contradictions);
      const covered = unionSpans([...payableZones, ...nonworkZones, ...contradictionZones]);
      const heldZones = subtractSpans([candidate], covered);
      for (const zone of payableZones) {
        const key = nextKey("inactivity", zone);
        parts = applyZone(parts, zone, "payable", key, (part) => part.category === "payable");
        findings.push(finding(input, key, "inactivity", "auto_payable", "payable", zone, zone.endMs - zone.startMs,
          "Continuous verified zero activity is covered by meeting, training, reading or work evidence.", false, "none"));
      }
      for (const zone of nonworkZones) {
        const key = nextKey("inactivity", zone);
        parts = applyZone(parts, zone, "inactivity", key, (part) => part.category === "payable");
        findings.push(finding(input, key, "inactivity", "auto_excluded", "exclude", zone, zone.endMs - zone.startMs,
          "Continuous verified zero activity with clear non-work evidence; the whole run is excluded.", false, "none"));
      }
      for (const zone of [...contradictionZones, ...heldZones]) {
        const key = nextKey("inactivity", zone);
        parts = applyZone(parts, zone, "held", key, (part) => part.category === "payable");
        findings.push(finding(input, key, "inactivity", "needs_review", "hold", zone, zone.endMs - zone.startMs,
          contradictionZones.some((item) => item.startMs === zone.startMs && item.endMs === zone.endMs)
            ? "Zero-activity evidence conflicts with work-related evidence; hold the run for review."
            : "Continuous verified zero activity has no clear non-work signal; hold the run for review.", true, "decide"));
      }
    }
  }

  const coverage = unionSpans(input.captures
    .filter((capture) => capture.activity !== null && capture.span)
    .map((capture) => capture.span!));
  const gapSpans = subtractSpans(subtractSpans(tracked, coverage), unionSpans(input.breaks.map((item) => item.span)));
  let gapTotal = 0;
  for (const span of gapSpans) {
    const gapMs = span.endMs - span.startMs;
    if (gapMs < GAP_FLAG_MS) continue;
    gapTotal += gapMs;
    const key = nextKey("unverified_gap", span);
    parts = tagZone(parts, span, key, (part) => part.findingKey === null);
    findings.push(finding(input, key, "unverified_gap", "needs_review", "acknowledge", span, gapMs,
      "Tracked time has no valid activity coverage; it stays payable and requires acknowledgement.", true, "acknowledge"));
  }
  const trackedMs = duration(tracked);
  if (gapTotal > 0 && (gapTotal / Math.max(1, trackedMs) > LOW_EVIDENCE_RATIO || gapSpans.some((span) => span.endMs - span.startMs > LOW_EVIDENCE_CONTINUOUS_MS))) {
    const key = nextKey("low_evidence", null);
    findings.push(finding(input, key, "low_evidence", "needs_review", "acknowledge", null, gapTotal,
      "More than 20% of tracked time is unverified, or a single gap exceeds 30 minutes.", true, "acknowledge"));
  }

  for (const span of outside) {
    const key = nextKey("outside_window", span);
    findings.push(finding(input, key, "outside_window", "auto_excluded", "exclude", span, span.endMs - span.startMs,
      "Recorded time is outside the eligible schedule window and is never payable here.", false, "none"));
  }

  for (const reason of blockers) {
    const kind: PayrollFindingKind = /schedule/i.test(reason) ? "no_schedule" : /session/i.test(reason) ? "no_session" : "source_conflict";
    const key = nextKey(kind, null);
    findings.push(finding(input, key, kind, "needs_correction", "acknowledge", null, 0, reason, true, "correct"));
  }
  if (duration(unionSpans([...sessionRecorded, ...captureSpans])) === 0 && !blockers.some((line) => /leave/i.test(line))) {
    const key = nextKey("no_work", null);
    findings.push(finding(input, key, "no_work", "needs_review", "acknowledge", null, 0,
      "No work was recorded for this workday; acknowledge the empty day.", true, "acknowledge"));
  }

  const exactMs = exactFrom(parts);
  const recordedMs = duration(unionSpans([...sessionRecorded, ...captureSpans]));
  if (Object.values(exactMs).reduce((sum, value) => sum + value, 0) !== recordedMs) {
    throw new Error("Payroll partition does not cover recorded time exactly");
  }
  findings.sort((left, right) => (left.span?.startMs ?? -1) - (right.span?.startMs ?? -1) || left.key.localeCompare(right.key));
  return {
    id: null, scope: input.scope, date: input.date, week: input.week, partition: parts,
    exactMs, minutes: totalsFrom(exactMs), findings, blockers: blockers.length ? blockers : derivedBlockers,
    sourceHash: input.sourceHash, decisionKeys: [], decisionState: {}, decisionAmounts: {},
  };
}

function reassign(parts: Part[], key: string, allowed: Category[], category: Category): Part[] {
  return compact(parts.map((part) => part.findingKey === key && allowed.includes(part.category) ? { ...part, category } : part));
}

function unlocatedExcluded(parts: Part[], state: Record<string, string>, amounts: Record<string, number>): number {
  return Object.entries(state).reduce((sum, [key, action]) => sum + (action === "excluded" ? amounts[key] ?? 0 : 0), 0);
}

export function applyPayrollDecisions(day: PayrollDayResult, decisions: FindingDecision[]): PayrollDayResult {
  let parts = compact(day.partition.map((part) => ({ ...part, span: { ...part.span } })));
  const findings = day.findings.map((item) => ({ ...item }));
  const state = { ...(day.decisionState ?? {}) };
  const amounts = { ...(day.decisionAmounts ?? {}) };
  const keys = [...day.decisionKeys];

  for (const decision of decisions) {
    const finding = findings.find((item) => item.key === decision.findingKey);
    if (!finding) throw new Error("Unknown payroll finding");
    if (!decision.note?.trim()) throw new Error("A payroll decision requires a reason");
    if (finding.sourceHash !== decision.sourceHash) throw new Error("Stale payroll decision: the source evidence changed");
    if (finding.kind === "break") throw new Error("Break time is already excluded; use a manual adjustment to pay it");
    if (finding.kind === "outside_window") throw new Error("Outside-window time requires a schedule or session correction");
    if (finding.requiredAction === "correct") throw new Error("Structural payroll findings require source correction");
    if (state[finding.key] === decision.action) continue;

    if (decision.action === "acknowledged") {
      if (finding.effect !== "acknowledge") throw new Error("A held or excluded interval cannot only be acknowledged");
      state[finding.key] = "acknowledged";
    } else if (decision.action === "payable") {
      if (finding.span && validSpan(finding.span)) {
        const allowed: Category[] = finding.kind === "activity_during_break" ? ["held", "break"] : ["held", "inactivity", "manual", "payable"];
        parts = reassign(parts, finding.key, allowed, "payable");
        state[finding.key] = "payable";
      } else if (state[finding.key] === "excluded" && (amounts[finding.key] ?? 0) > 0) {
        state[finding.key] = "payable";
      } else if (finding.effect === "acknowledge") {
        // Confirming an acknowledge-only finding changes provenance, not time.
        state[finding.key] = "payable";
      } else {
        throw new Error("No payroll debit exists to reverse");
      }
    } else {
      const target: Category = finding.kind === "inactivity" ? "inactivity" : finding.kind === "activity_during_break" ? "break" : "manual";
      if (finding.span && validSpan(finding.span)) {
        parts = reassign(parts, finding.key, ["payable", "held"], target);
      } else {
        const available = partsOf(parts, "payable").reduce((sum, span) => sum + span.endMs - span.startMs, 0);
        amounts[finding.key] = Math.min(finding.durationMs, available);
      }
      state[finding.key] = "excluded";
    }
    if (!keys.includes(finding.key)) keys.push(finding.key);
    const status: PayrollFindingStatus = state[finding.key] === "payable" ? "resolved_payable"
      : state[finding.key] === "excluded" ? "resolved_excluded" : "acknowledged";
    finding.status = status;
  }

  const exactMs = exactFrom(parts);
  const net = unlocatedExcluded(parts, state, amounts);
  if (net > 0) {
    exactMs.payable -= net;
    exactMs.manual += net;
  }
  if (exactMs.payable < 0) throw new Error("Payroll manual exclusion exceeds the payable budget");
  return {
    ...day, partition: parts, exactMs, minutes: totalsFrom(exactMs), findings, decisionKeys: keys,
    decisionState: state, decisionAmounts: amounts,
  };
}
