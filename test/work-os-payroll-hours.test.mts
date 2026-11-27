import assert from "node:assert/strict";
import test from "node:test";
import { unionSpans } from "../src/lib/work-os-payroll-intervals";
import type {
  FindingDecision, NormalizedActivity, PayrollDayInput, PayrollDayResult, Span,
} from "../src/modules/work-os/payroll/contracts";

// The break these catch: paying pre-shift time, treating a gap as zero, letting
// a break deduct twice, or a decision changing the same span twice.
const hours = () => import("../src/lib/work-os-payroll-hours");

const scope = { organizationId: "10000000-0000-4000-8000-000000000001", personId: "20000000-0000-4000-8000-000000000001" };
const t = (value: string) => Date.parse(`2026-11-02T${value}:00.000Z`);
const sp = (from: string, to: string): Span => ({ startMs: t(from), endMs: t(to) });
const spanMs = (startMs: number, endMs: number): Span => ({ startMs, endMs });
const cap = (startMs: number, endMs: number, activity: number | null, over: Partial<NormalizedActivity> = {}): NormalizedActivity => ({
  id: `cap-${startMs}-${endMs}-${String(activity)}`, employeeId: "emp-1",
  capturedAt: new Date(startMs).toISOString(), span: { startMs, endMs }, activity,
  zeroEligible: activity === 0, status: activity === 0 ? 3 : 1,
  app: "Editor", title: "Editor", domain: null, productivityCode: null, ...over,
});
function everyMinute(from: string, to: string, activity: number | null, over: Partial<NormalizedActivity> = {}) {
  const out: NormalizedActivity[] = [];
  for (let at = t(from); at < t(to); at += 60_000) out.push(cap(at, Math.min(at + 60_000, t(to)), activity, over));
  return out;
}
const session = (recorded: Span | null, eligible: Span | null, over: Partial<PayrollDayInput["sessions"][number]> = {}) => ({
  id: "s1", recorded, eligible, closed: true, scheduleSource: "schedule", correctionStatus: "original", ...over,
});
const input = (over: Partial<PayrollDayInput> = {}): PayrollDayInput => ({
  scope, date: "2026-11-02", week: 1, timezone: "UTC",
  sessions: [session(sp("15:00", "21:10"), sp("15:00", "22:00"))],
  breaks: [], pauseResidualMs: 0, captures: [], exceptions: [], frameSignals: [],
  frameCandidates: [], blockers: [], sourceHash: "source-a", ...over,
});
function example370m(): PayrollDayInput {
  const zeroRun: NormalizedActivity[] = everyMinute("17:00", "17:45", 0);
  const heldRun: NormalizedActivity[] = everyMinute("19:00", "19:10", 0);
  return input({
    captures: [
      ...everyMinute("15:00", "15:20", 30), ...everyMinute("15:40", "17:00", 30),
      ...zeroRun, ...everyMinute("17:45", "19:00", 30), ...heldRun, ...everyMinute("19:10", "21:10", 30),
    ],
    breaks: [{ span: sp("15:20", "15:40"), source: "scheduled" }],
    frameSignals: [{ span: sp("17:00", "17:45"), category: "nonwork", confidence: 0.9, citations: [] }],
  });
}
const heldFinding = (day: PayrollDayResult) => day.findings.find((finding) => finding.kind === "inactivity" && finding.status === "needs_review")!;
const payHeld = (day: PayrollDayResult): FindingDecision => ({
  requestKey: "pay-held", findingKey: heldFinding(day).key, sourceHash: heldFinding(day).sourceHash,
  action: "payable", note: "Verified the frame context with the employee",
});

test("aggregate findings on separate days can be reviewed independently", async () => {
  const { calculatePayrollDay } = await hours();
  const one = calculatePayrollDay(input({ date: "2026-11-02", sessions: [], blockers: ["Missing session"] }));
  const two = calculatePayrollDay(input({ date: "2026-11-03", sessions: [], blockers: ["Missing session"] }));
  for (const kind of ["no_session", "no_work"]) {
    const left = one.findings.find((finding) => finding.kind === kind);
    const right = two.findings.find((finding) => finding.kind === kind);
    assert.ok(left && right);
    assert.notEqual(left.key, right.key, `${kind} must not overwrite another day's saved finding`);
  }
});
function sparseZeroCapture(): PayrollDayInput {
  const start = t("09:00");
  return input({
    sessions: [session(spanMs(start, start + 3_600_000), spanMs(start, start + 3_600_000))],
    captures: [cap(start, start + 60_000, 0), cap(start + 16 * 60_000, start + 17 * 60_000, 30)],
  });
}
function zeroRun(seconds: number, frame = true): PayrollDayInput {
  const start = t("09:00");
  const end = start + seconds * 1000;
  const captures: NormalizedActivity[] = [];
  for (let at = start; at < end; at += 60_000) captures.push(cap(at, Math.min(at + 60_000, end), 0));
  return input({
    sessions: [session(spanMs(start, end), spanMs(start, end))],
    captures,
    frameSignals: frame ? [{ span: spanMs(start, end), category: "nonwork", confidence: 0.9, citations: [] }] : [],
  });
}

test("the 370-minute example partitions once and excludes every inactivity run of 3 minutes or more", async () => {
  const { calculatePayrollDay } = await hours();
  const day = calculatePayrollDay(example370m());
  assert.equal(day.minutes.eligibleTracked, 370);
  assert.equal(day.minutes.recorded, 370);
  assert.equal(day.minutes.outside, 0);
  assert.equal(day.minutes.break, 20);
  assert.equal(day.minutes.inactivity, 55);
  assert.equal(day.minutes.held, 0);
  assert.equal(day.minutes.manualExcluded, 0);
  assert.equal(day.minutes.recommended, 295);
  assert.equal(day.minutes.approved, 0);
  assert.equal(day.minutes.recorded, day.minutes.eligibleTracked + day.minutes.outside);
  assert.ok(day.minutes.recommended <= day.minutes.eligibleTracked);
  for (const value of Object.values(day.minutes)) assert.ok(value >= 0);
  const recorded = unionSpans([
    ...example370m().sessions.flatMap((item) => item.recorded ? [item.recorded] : []),
    ...example370m().captures.flatMap((item) => item.span ? [item.span] : []),
  ]);
  assert.deepEqual(unionSpans(day.partition.map((item) => item.span)), recorded);
  assert.equal(day.partition.reduce((sum, item) => sum + item.span.endMs - item.span.startMs, 0),
    recorded.reduce((sum, item) => sum + item.endMs - item.startMs, 0), "the partition has no overlaps");
  assert.equal(day.findings.some((finding) => finding.kind === "inactivity" && finding.status === "needs_review"), false);
  assert.ok(day.findings.some((finding) => finding.kind === "inactivity" && finding.status === "auto_excluded" && finding.minutes === 10));
});

test("inactivity needs three continuous minutes and never reaches into a gap", async () => {
  const { calculatePayrollDay } = await hours();
  const short = calculatePayrollDay(zeroRun(179));
  assert.equal(short.exactMs.inactivity, 0);
  assert.equal(short.minutes.inactivity, 0);
  assert.equal(short.minutes.recommended, 3);
  const exact = calculatePayrollDay(zeroRun(180));
  assert.equal(exact.exactMs.inactivity, 180_000);
  assert.equal(exact.minutes.inactivity, 3);
  assert.equal(exact.minutes.recommended, 0);
  const over = calculatePayrollDay(zeroRun(181));
  assert.equal(over.exactMs.inactivity, 181_000);
  assert.equal(over.minutes.inactivity, 3);
  assert.equal(over.minutes.recommended, 0);
  const sparse = calculatePayrollDay(sparseZeroCapture());
  assert.equal(sparse.minutes.inactivity, 0);
  assert.equal(sparse.minutes.held, 0);
  assert.equal(sparse.minutes.recommended, 60);
  assert.ok(sparse.findings.some((finding) => finding.kind === "unverified_gap" && finding.durationMs === 15 * 60_000));
});

test("sparse zero samples never bridge into a continuous inactivity run", async () => {
  const { calculatePayrollDay } = await hours();
  const start = t("09:00");
  const day = calculatePayrollDay(input({
    sessions: [session(spanMs(start, start + 11 * 60_000), spanMs(start, start + 11 * 60_000))],
    captures: [cap(start, start + 60_000, 0), cap(start + 5 * 60_000, start + 6 * 60_000, 0), cap(start + 10 * 60_000, start + 11 * 60_000, 0)],
  }));
  assert.equal(day.minutes.inactivity, 0);
  assert.equal(day.minutes.recommended, 11);
});

test("a null sample and an unknown capture split a zero run instead of extending it", async () => {
  const { calculatePayrollDay } = await hours();
  const start = t("09:00");
  const day = calculatePayrollDay(input({
    sessions: [session(spanMs(start, start + 180_000), spanMs(start, start + 180_000))],
    captures: [cap(start, start + 60_000, 0), cap(start + 60_000, start + 120_000, null), cap(start + 120_000, start + 180_000, 0)],
  }));
  assert.equal(day.exactMs.inactivity, 0);
  assert.equal(day.minutes.inactivity, 0);
  assert.equal(day.minutes.recommended, 3);
});

test("meeting, training and reading exceptions are payable; a partial exception only saves its own subspan", async () => {
  const { calculatePayrollDay } = await hours();
  for (const kind of ["meeting", "training", "reading", "work"] as const) {
    const start = t("09:00");
    const day = calculatePayrollDay(input({
      sessions: [session(spanMs(start, start + 180_000), spanMs(start, start + 180_000))],
      captures: [cap(start, start + 180_000, 0)],
      exceptions: [{ span: spanMs(start, start + 180_000), kind, citations: [] }],
    }));
    assert.equal(day.minutes.inactivity, 0, kind);
    assert.equal(day.minutes.recommended, 3, kind);
    assert.ok(day.findings.some((finding) => finding.kind === "inactivity" && finding.status === "auto_payable"), kind);
  }
  const start = t("09:00");
  const end = start + 45 * 60_000;
  const partial = calculatePayrollDay(input({
    sessions: [session(spanMs(start, end), spanMs(start, end))],
    captures: Array.from({ length: 45 }, (_, index) => cap(start + index * 60_000, start + (index + 1) * 60_000, 0)),
    exceptions: [{ span: spanMs(start, start + 15 * 60_000), kind: "meeting", citations: [] }],
    frameSignals: [{ span: spanMs(start + 15 * 60_000, end), category: "nonwork", confidence: 0.9, citations: [] }],
  }));
  assert.equal(partial.exactMs.inactivity, 30 * 60_000);
  assert.equal(partial.minutes.recommended, 15);
  const noNonwork = calculatePayrollDay(input({
    sessions: [session(spanMs(start, end), spanMs(start, end))],
    captures: Array.from({ length: 45 }, (_, index) => cap(start + index * 60_000, start + (index + 1) * 60_000, 0)),
    exceptions: [{ span: spanMs(start, start + 15 * 60_000), kind: "meeting", citations: [] }],
  }));
  assert.equal(noNonwork.minutes.recommended, 15);
  assert.equal(noNonwork.minutes.held, 0);
  assert.equal(noNonwork.minutes.inactivity, 30);
});

test("contradictory zero-run evidence is held rather than paid or deducted", async () => {
  const { calculatePayrollDay } = await hours();
  const start = t("09:00");
  const day = calculatePayrollDay(input({
    sessions: [session(spanMs(start, start + 180_000), spanMs(start, start + 180_000))],
    captures: [cap(start, start + 180_000, 0)],
    exceptions: [{ span: spanMs(start, start + 180_000), kind: "meeting", citations: [] }],
    frameSignals: [{ span: spanMs(start, start + 180_000), category: "nonwork", confidence: 0.9, citations: [] }],
  }));
  assert.equal(day.minutes.held, 3);
  assert.equal(day.minutes.inactivity, 0);
  assert.equal(day.minutes.recommended, 0);
});

test("breaks union across sources and activity during a break never becomes payable", async () => {
  const { calculatePayrollDay } = await hours();
  const overlapping = calculatePayrollDay(input({
    sessions: [session(sp("15:00", "16:00"), sp("15:00", "16:00"))],
    captures: [...everyMinute("15:00", "15:10", 30), ...everyMinute("15:30", "16:00", 30)],
    breaks: [{ span: sp("15:10", "15:30"), source: "scheduled" }, { span: sp("15:20", "15:30"), source: "provider" }],
  }));
  assert.equal(overlapping.minutes.break, 20);
  assert.equal(overlapping.minutes.recommended, 40);
  const disputed = calculatePayrollDay(input({
    sessions: [session(sp("15:00", "16:00"), sp("15:00", "16:00"))],
    captures: [...everyMinute("15:00", "15:10", 30), ...everyMinute("15:10", "15:30", 5), ...everyMinute("15:30", "16:00", 30)],
    breaks: [{ span: sp("15:10", "15:30"), source: "scheduled" }],
  }));
  assert.equal(disputed.minutes.break, 20);
  assert.equal(disputed.minutes.held, 0);
  assert.equal(disputed.minutes.recommended, 40);
  assert.equal(disputed.findings.some((item) => item.kind === "activity_during_break"), false);
  const finding = disputed.findings.find((item) => item.kind === "break")!;
  assert.equal(finding.status, "auto_excluded");
  assert.match(finding.reason, /break/i);
  assert.match(finding.reason, /not work/i);
});test("near-adjacent provider break slices merge into one break run", async () => {
  const { calculatePayrollDay } = await hours();
  const day = calculatePayrollDay(input({
    sessions: [session(spanMs(t("15:00"), t("15:10")), spanMs(t("15:00"), t("15:10")))],
    captures: everyMinute("15:00", "15:10", 30),
    breaks: [
      { span: spanMs(t("15:02"), t("15:03")), source: "provider" },
      { span: spanMs(t("15:03") + 3_000, t("15:04") + 3_000), source: "provider" },
    ],
  }));
  const findings = day.findings.filter((finding) => finding.kind === "break");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.minutes, 2);
});

test("pre-shift and end-plus-sixty boundaries are excluded exactly", async () => {
  const { calculatePayrollDay } = await hours();
  const pre = calculatePayrollDay(input({
    captures: [...everyMinute("14:50", "15:00", 30), ...everyMinute("15:00", "16:00", 30)],
    sessions: [session(sp("15:00", "16:00"), sp("15:00", "17:00"))],
  }));
  assert.equal(pre.exactMs.outside, 10 * 60_000);
  assert.equal(pre.exactMs.payable, 60 * 60_000);
  assert.equal(pre.minutes.outside, 10);
  assert.ok(pre.findings.some((finding) => finding.kind === "outside_window"));
  const insideGrace = calculatePayrollDay(input({
    sessions: [session(sp("15:00", "16:00"), sp("15:00", "17:00"))],
    captures: [cap(Date.parse("2026-11-02T16:59:30Z"), t("17:00"), 30)],
  }));
  assert.equal(insideGrace.exactMs.outside, 0);
  assert.equal(insideGrace.exactMs.payable, 3_630_000);
  const atBoundary = calculatePayrollDay(input({
    sessions: [session(sp("15:00", "16:00"), sp("15:00", "17:00"))],
    captures: [cap(t("17:00"), t("17:01"), 30)],
  }));
  assert.equal(atBoundary.exactMs.outside, 60_000);
  assert.equal(atBoundary.exactMs.payable, 3_600_000);
});

test("an aggregate pause residual blocks reconciliation without inventing a break span", async () => {
  const { calculatePayrollDay } = await hours();
  const day = calculatePayrollDay(input({ sessions: [session(sp("15:00", "16:00"), sp("15:00", "16:00"))], captures: everyMinute("15:00", "16:00", 30), pauseResidualMs: 10 * 60_000 }));
  assert.equal(day.minutes.break, 0);
  assert.equal(day.minutes.manualExcluded, 0);
  assert.equal(day.minutes.recommended, 60);
  const mismatch = day.findings.find((finding) => finding.kind === "break_mismatch")!;
  assert.equal(mismatch.blocksApproval, true);
  assert.equal(mismatch.requiredAction, "acknowledge");
});

test("gaps stay payable but require acknowledgement; low evidence is called out separately", async () => {
  const { calculatePayrollDay } = await hours();
  const day = calculatePayrollDay(input({ sessions: [session(sp("15:00", "16:00"), sp("15:00", "16:00"))], captures: [...everyMinute("15:00", "15:20", 30), ...everyMinute("15:30", "16:00", 30)] }));
  assert.equal(day.minutes.recommended, 60);
  assert.equal(day.minutes.inactivity, 0);
  const gap = day.findings.find((finding) => finding.kind === "unverified_gap")!;
  assert.equal(gap.durationMs, 10 * 60_000);
  assert.equal(gap.blocksApproval, true);
  assert.equal(gap.requiredAction, "acknowledge");
  const low = calculatePayrollDay(input({ sessions: [session(sp("15:00", "16:00"), sp("15:00", "16:00"))], captures: everyMinute("15:00", "15:10", 30) }));
  const warning = low.findings.find((finding) => finding.kind === "low_evidence")!;
  assert.equal(warning.blocksApproval, false);
  assert.equal(warning.requiredAction, "none");
});

test("rejecting a legacy low-evidence summary cannot deduct a timed gap twice", async () => {
  const { calculatePayrollDay, applyPayrollDecisions } = await hours();
  const day = calculatePayrollDay(input({
    sessions: [session(sp("15:00", "16:00"), sp("15:00", "16:00"))],
    captures: [...everyMinute("15:00", "15:10", 30), ...everyMinute("15:30", "16:00", 30)],
  }));
  const gap = day.findings.find((finding) => finding.kind === "unverified_gap")!;
  const summary = day.findings.find((finding) => finding.kind === "low_evidence")!;
  Object.assign(summary, { status: "needs_review", requiredAction: "acknowledge", blocksApproval: true });
  const exclude = (findingKey: string): FindingDecision => ({
    findingKey, sourceHash: day.sourceHash, action: "excluded", requestKey: findingKey, note: "Reviewed evidence",
  });
  const afterGap = applyPayrollDecisions(day, [exclude(gap.key)]);
  assert.equal(afterGap.minutes.recommended, 40);
  assert.throws(() => applyPayrollDecisions(afterGap, [exclude(summary.key)]), /informational/i);
});

test("no schedule, open sessions, leave work and no work are explicit blockers", async () => {
  const { calculatePayrollDay } = await hours();
  const noSchedule = calculatePayrollDay(input({
    sessions: [session(sp("09:00", "10:00"), null)],
    captures: everyMinute("09:00", "10:00", 30),
  }));
  assert.equal(noSchedule.exactMs.outside, 3_600_000);
  assert.ok(noSchedule.blockers.some((line) => /schedule/i.test(line)));
  assert.ok(noSchedule.findings.some((finding) => finding.status === "needs_correction"));
  const open = calculatePayrollDay(input({ sessions: [session(sp("15:00", "15:30"), sp("15:00", "22:00"), { closed: false })] }));
  assert.ok(open.blockers.some((line) => /open session/i.test(line)));
  assert.ok(open.findings.some((finding) => finding.blocksApproval && finding.requiredAction === "correct"));
  const leave = calculatePayrollDay(input({ blockers: ["Leave day has recorded work"], captures: everyMinute("15:00", "16:00", 30) }));
  assert.ok(leave.findings.some((finding) => finding.status === "needs_correction" && finding.blocksApproval));
  const none = calculatePayrollDay(input({ sessions: [], captures: [] }));
  assert.equal(none.minutes.recorded, 0);
  assert.ok(none.findings.some((finding) => finding.kind === "no_work" && finding.blocksApproval));
});

test("decisions reject stale, structurally invalid and reasonless changes", async () => {
  const { calculatePayrollDay, applyPayrollDecisions } = await hours();
  const start = t("09:00");
  const day = calculatePayrollDay(input({
    sessions: [session(spanMs(start, start + 180_000), spanMs(start, start + 180_000))],
    captures: [cap(start, start + 180_000, 0)],
    exceptions: [{ span: spanMs(start, start + 180_000), kind: "meeting", citations: [] }],
    frameSignals: [{ span: spanMs(start, start + 180_000), category: "nonwork", confidence: 0.9, citations: [] }],
  }));
  const decision = payHeld(day);
  assert.throws(() => applyPayrollDecisions(day, [{ ...decision, sourceHash: "old-source" }]), /stale|source/i);
  assert.throws(() => applyPayrollDecisions(day, [{ ...decision, note: "" }]), /reason|note/i);
  assert.throws(() => applyPayrollDecisions(day, [{ ...decision, action: "acknowledged" }]), /acknowledge/i);
  const breakDay = calculatePayrollDay(example370m());
  const breakFinding = breakDay.findings.find((finding) => finding.kind === "break")!;
  assert.throws(() => applyPayrollDecisions(breakDay, [{ requestKey: "pay-break", findingKey: breakFinding.key, sourceHash: breakFinding.sourceHash, action: "payable", note: "Pay it" }]), /break/i);
  const gapDay = calculatePayrollDay(input({ sessions: [session(sp("15:00", "16:00"), sp("15:00", "16:00"))], captures: everyMinute("15:00", "15:10", 30) }));
  const gap = gapDay.findings.find((finding) => finding.kind === "unverified_gap")!;
  const excluded = applyPayrollDecisions(gapDay, [{ requestKey: "exclude-gap", findingKey: gap.key, sourceHash: gap.sourceHash, action: "excluded", note: "No evidence of work in this interval" }]);
  assert.equal(excluded.minutes.recommended, 10);
  assert.equal(excluded.minutes.manualExcluded, 50);
  const confirmed = applyPayrollDecisions(gapDay, [{ requestKey: "confirm-gap", findingKey: gap.key, sourceHash: gap.sourceHash, action: "payable", note: "Evidence confirms the gap remains payable" }]);
  assert.equal(confirmed.minutes.recommended, 60);
});

test("period totals are the sum of displayed day totals", async () => {
  const { calculatePayrollDay } = await hours();
  const days = [calculatePayrollDay(example370m()), calculatePayrollDay(sparseZeroCapture())];
  const sum = days.reduce((total, day) => total + day.minutes.recorded, 0);
  assert.equal(sum, 370 + 60);
  assert.equal(days.reduce((total, day) => total + day.minutes.eligibleTracked, 0), 430);
});
