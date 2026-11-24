import type { QueryClient } from "@tanstack/react-query";
import type {
  PayrollApproval, PayrollDayResult, PayrollFinding, PayrollPeriod, PayrollReview, PayrollRosterPage, PayrollTotals,
} from "../../../../../src/modules/work-os/payroll/contracts";
import { defaultPayDate } from "./PayrollPage";
import { desktopPayrollKey } from "./api";

/** Deterministic synthetic payroll for the dev-only `?preview-admin` harness.
 * Every name, number, and finding below is invented for rendered QA. No record
 * here comes from Worktivity, Work OS, or a real employee. */

function dateOffset(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const zero = (): PayrollTotals => ({
  recorded: 0, eligibleTracked: 0, outside: 0, break: 0, inactivity: 0,
  held: 0, manualExcluded: 0, recommended: 0, approved: 0,
});

type DaySeed = [offset: number, recorded: number, outside: number, breakMinutes: number, held: number];
const DAY_SEEDS: DaySeed[] = [
  [0, 359, 0, 30, 0], [1, 396, 0, 30, 0], [2, 324, 0, 30, 1], [3, 333, 0, 30, 0], [4, 324, 0, 30, 0],
  [7, 360, 5, 30, 0], [8, 366, 0, 30, 0], [10, 378, 0, 30, 0], [11, 380, 0, 30, 0], [12, 376, 0, 0, 5],
];

export function seedPayrollPreview(client: QueryClient, session: { organizationId: string; userId: string }, empty: boolean) {
  const payDate = defaultPayDate();
  const through = dateOffset(payDate, -1);
  const from = payDate.endsWith("-16") ? `${payDate.slice(0, 7)}-01` : `${through.slice(0, 7)}-16`;
  const period: PayrollPeriod = {
    payDate, from, through, timezone: "America/New_York",
    weeks: [{ week: 1, from, through: dateOffset(from, 6) }, { week: 2, from: dateOffset(from, 7), through }],
  };
  const keys = desktopPayrollKey(session.organizationId, session.userId);
  const scopeFor = (personId: string) => ({ organizationId: session.organizationId, personId });
  const citation = (id: string, revision = 2) => ({ type: "interval" as const, id, revision });

  const totals: PayrollTotals = { recorded: 3596, eligibleTracked: 3591, outside: 5, break: 270, inactivity: 0, held: 6, manualExcluded: 0, recommended: 3315, approved: 0 };
  const days = DAY_SEEDS.map(([offset, recorded, outside, breakMinutes, held], index): PayrollDayResult => {
    const date = dateOffset(from, offset);
    const week = date <= period.weeks[0].through ? 1 : 2;
    const eligibleTracked = recorded - outside;
    const recommended = eligibleTracked - breakMinutes - held;
    const startMs = Date.parse(`${date}T${index % 3 === 0 ? "08:05" : "08:12"}:00-05:00`);
    const endMs = startMs + recorded * 60_000;
    return {
      id: `fixture-day-${index + 1}`, scope: scopeFor("fixture-payroll-person"), date, week, partition: [],
      exactMs: { payable: recommended * 60_000, break: breakMinutes * 60_000, inactivity: 0, held: held * 60_000, manual: 0, outside: outside * 60_000 },
      minutes: { recorded, eligibleTracked, outside, break: breakMinutes, inactivity: 0, held, manualExcluded: 0, recommended, approved: 0 },
      findings: [], blockers: [], sourceHash: `fixture-day-${index + 1}`, decisionKeys: [],
      evidence: {
        scheduleSource: index === 5 ? "historical_schedule" : "employee_schedule", sampledFrames: 3 + (index % 2),
        sessions: [
          { recorded: { startMs, endMs }, eligible: { startMs: startMs - 5 * 60_000, endMs: endMs + 30 * 60_000 } },
        ],
      },
    };
  });
  const dayDates = days.map((day) => day.date);
  const finding = (over: Partial<PayrollFinding> & Pick<PayrollFinding, "key" | "kind" | "date" | "reason">): PayrollFinding => {
    const { key, kind, date, reason, ...rest } = over;
    return {
      id: `fixture-finding-${key}`, key, kind, date, reason, scope: scopeFor("fixture-payroll-person"),
      dayId: `fixture-day-${Math.max(1, dayDates.indexOf(date) + 1)}`, status: "needs_review", effect: "hold",
      span: null, durationMs: 0, minutes: 0, sourceHash: `fixture-${key}`, blocksApproval: true,
      requiredAction: "decide", citations: [citation(`fixture-${kind}`, 3)], ...rest,
    };
  };
  const dd = (index: number) => dayDates[index]!;
  const span = (date: string, start: string, end: string) => ({
    startMs: Date.parse(`${date}T${start}:00-05:00`), endMs: Date.parse(`${date}T${end}:00-05:00`),
  });
  const findings: PayrollFinding[] = [
    finding({ key: "outside_window:fixture-1", kind: "outside_window", date: dd(5), status: "auto_excluded", effect: "exclude",
      requiredAction: "none", blocksApproval: false, span: span(dd(5), "07:55", "08:00"), durationMs: 300_000, minutes: 5,
      reason: "Recorded time began before the scheduled shift and is outside the eligible window." }),
    finding({ key: "break:fixture-2", kind: "break", date: dd(1), status: "auto_excluded", effect: "exclude",
      requiredAction: "none", blocksApproval: false, span: span(dd(1), "12:30", "13:00"), durationMs: 1_800_000, minutes: 30,
      reason: "Recorded lunch break is unpaid and was deducted once." }),
    finding({ key: "activity_during_break:fixture-3", kind: "activity_during_break", date: dd(2),
      span: span(dd(2), "12:42", "12:51"), durationMs: 540_000, minutes: 9,
      reason: "Activity was recorded during the unpaid lunch break. Decide whether this interval was worked." }),
    finding({ key: "inactivity:fixture-4", kind: "inactivity", date: dd(9), span: span(dd(9), "15:31", "15:37"),
      durationMs: 360_000, minutes: 6,
      reason: "Zero activity ran for six minutes without clear meeting, training, or non-work evidence." }),
    finding({ key: "activity_during_break:fixture-5", kind: "activity_during_break", date: dd(7),
      span: span(dd(7), "13:05", "13:08"), durationMs: 180_000, minutes: 3,
      reason: "A short activity burst overlaps the scheduled break. Decide whether to keep it payable." }),
    finding({ key: "unverified_gap:fixture-6", kind: "unverified_gap", date: dd(0), effect: "acknowledge", requiredAction: "acknowledge",
      span: span(dd(0), "10:14", "10:31"), durationMs: 1_020_000, minutes: 17,
      reason: "Tracked time has no valid activity coverage for 17 minutes and stays payable after acknowledgement." }),
    finding({ key: "unverified_gap:fixture-7", kind: "unverified_gap", date: dd(3), effect: "acknowledge", requiredAction: "acknowledge",
      span: span(dd(3), "14:02", "14:24"), durationMs: 1_320_000, minutes: 22,
      reason: "Capture coverage stopped during the afternoon session and never reported a zero sample." }),
    finding({ key: "unverified_gap:fixture-8", kind: "unverified_gap", date: dd(8), effect: "acknowledge", requiredAction: "acknowledge",
      span: span(dd(8), "09:40", "09:58"), durationMs: 1_080_000, minutes: 18,
      reason: "A provider capture gap leaves 18 minutes payable only with an explicit acknowledgement." }),
    finding({ key: "low_evidence:fixture-9", kind: "low_evidence", date: dd(3), effect: "acknowledge", requiredAction: "acknowledge",
      durationMs: 2_400_000, minutes: 40,
      reason: "More than 20% of this day's tracked time is unverified, or one gap exceeds 30 minutes." }),
    finding({ key: "break_mismatch:fixture-10", kind: "break_mismatch", date: dd(4), effect: "acknowledge", requiredAction: "acknowledge",
      span: span(dd(4), "12:28", "12:44"), durationMs: 960_000, minutes: 16,
      reason: "The scheduled break and the provider break records differ. Review the overlap before approval." }),
    finding({ key: "activity_during_break:fixture-11", kind: "activity_during_break", date: dd(9),
      span: span(dd(9), "12:31", "12:34"), durationMs: 180_000, minutes: 3,
      reason: "An activity sample falls inside the lunch break and needs a payable or excluded decision." }),
    finding({ key: "no_schedule:fixture-12", kind: "no_schedule", date: dd(6), status: "needs_correction", effect: "acknowledge",
      requiredAction: "correct",
      reason: "The recorded shift stamp conflicts with the historical schedule. Correct the attendance record, then re-analyze." }),
  ];
  days.forEach((day) => {
    day.findings = findings.filter((item) => item.date === day.date);
    if (day.date === dd(6)) day.blockers = ["Session schedule stamp conflicts with the historical schedule; correct the attendance record"];
  });
  const brief = (week: 1 | 2, title: string, summary: string, theme: string, detail: string, open: string, gap: string) => ({
    week, status: "ready" as const, title, summary, summaryCitations: [citation("fixture-recap-724", 3)],
    themes: [{ heading: theme, detail, citations: [citation("fixture-recap-724", 3)] }],
    openItems: [{ text: open, citations: [citation("fixture-recap-731", 2)] }],
    gaps: [gap], sourceHash: `fixture-week-${week}`,
  });
  const briefs = [
    brief(1, "Release readiness", "Updated the release runbook, checked the staging sequence, and recorded the rollback path.",
      "Deployment checks", "Verified the staging sequence and recorded the rollback checklist.", "Confirm the rollout owner before the next release.", "One capture window had incomplete coverage."),
    brief(2, "Handoff and follow-through", "Prepared the support handoff, reviewed the intake queue, and documented the remaining risks.",
      "Support handoff", "Grouped the open intake items and noted the owner for each.", "Close the two unassigned intake items.", "Friday capture coverage is incomplete."),
  ];

  const review = (over: Partial<PayrollReview> & Pick<PayrollReview, "id" | "scope" | "status" | "token">): PayrollReview => ({
    period, totals, briefs, blockers: [], run: null, approval: null,
    retentionExpiresAt: `${dateOffset(payDate, 30)}T00:00:00Z`, firstExportAt: null, evidenceChangedSinceApproval: false,
    providerVerifiedAt: `${dateOffset(through, 1)}T17:20:00Z`, recapStats: { employeeReviewed: 39, autoApproved: 4, pending: 0 }, ...over,
  });

  const needsReview = review({
    id: "fixture-payroll-audit", scope: scopeFor("fixture-payroll-person"), status: "needs_review",
    token: { rowVersion: "12", analysisRevision: 2, sourceHash: "fixture-source-audit" },
    blockers: [], recapStats: { employeeReviewed: 39, autoApproved: 4, pending: 2 },
  });

  const approvedTotals: PayrollTotals = {
    ...totals, held: 0, recommended: totals.recommended + totals.held, approved: totals.recommended + totals.held,
  };
  const approval: PayrollApproval = {
    id: "fixture-payroll-approval", reviewId: "fixture-payroll-approved", scope: scopeFor("fixture-payroll-approved-person"),
    revision: 1, period, approvedAt: `${payDate}T14:05:00Z`, approvedBy: "fixture-admin", note: "Synthetic preview approval",
    totals: approvedTotals,
    days: days.map((day) => ({
      date: day.date,
      minutes: { ...day.minutes, held: 0, recommended: day.minutes.recommended + day.minutes.held, approved: day.minutes.recommended + day.minutes.held },
      status: "resolved", schedule: day.evidence?.scheduleSource ?? "", sessionCount: day.evidence?.sessions.length ?? 0,
    })),
    briefs, snapshotHash: "fixture-receipt-hash-7f3a9c21", schemaVersion: "payroll-approval-v1",
    identity: { displayName: "Luis Moreno" }, findings: [],
  };
  const approved = review({
    id: "fixture-payroll-approved", scope: scopeFor("fixture-payroll-approved-person"), status: "approved",
    token: { rowVersion: "9", analysisRevision: 1, sourceHash: "fixture-source-approved" },
    totals: approvedTotals, approval, recapStats: { employeeReviewed: 38, autoApproved: 2, pending: 0 },
  });
  const approvedReviewDays = days.map((day) => ({
    ...day, id: `${day.id}-approved`, scope: approved.scope, findings: [],
    minutes: { ...day.minutes, held: 0, recommended: day.minutes.recommended + day.minutes.held, approved: day.minutes.recommended + day.minutes.held },
  }));

  const failedAudit = review({
    id: "fixture-payroll-failed", scope: scopeFor("fixture-payroll-failed-person"), status: "failed",
    token: { rowVersion: "1", analysisRevision: 0, sourceHash: "" }, totals: zero(), briefs: [],
    recapStats: { employeeReviewed: 0, autoApproved: 0, pending: 0 },
    run: {
      id: "fixture-run-1", reviewId: "fixture-payroll-failed", scope: scopeFor("fixture-payroll-failed-person"), targetRevision: 1,
      asOf: `${payDate}T12:00:00Z`, rowVersion: "1",
      progress: { phase: "evidence", message: "The provider read was incomplete.", days: 10, daysDone: 6, framesClassified: 0, framesReused: 0, findings: 0, remaining: 4, status: "failed", nextAttemptAt: null },
    },
  });

  const row = (personId: string, displayName: string, id: string | null, status: string, amounts: PayrollTotals, auditStatus: "done" | "queued" | "running" | "failed") =>
    ({ personId, displayName, active: true, mapped: true, reviewId: id, status, auditStatus, totals: amounts, workdays: DAY_SEEDS.length });
  const roster: PayrollRosterPage = {
    items: empty ? [] : [
      row("fixture-payroll-person", "Ada Okafor", needsReview.id, "needs_review", totals, "done"),
      row("fixture-payroll-approved-person", "Luis Moreno", approved.id, "approved", approvedTotals, "done"),
      row("fixture-payroll-failed-person", "Mei Tanaka", failedAudit.id, "failed", zero(), "failed"),
    ],
    total: empty ? 0 : 3, nextCursor: null, period, counts: empty ? {} : { needs_review: 1, approved: 1, failed: 1 },
  };

  const seedReview = (record: PayrollReview, recordDays: PayrollDayResult[], pageFindings: PayrollFinding[]) => {
    client.setQueryData([...keys, "review", record.id], record);
    if (record.token.analysisRevision > 0) {
      client.setQueryData([...keys, "days", record.id, record.token.analysisRevision], { items: recordDays, total: recordDays.length, nextCursor: null });
    }
    const pageOne = pageFindings.slice(0, 6);
    const pageTwo = pageFindings.slice(6);
    client.setQueryData([...keys, "findings", record.id, record.token.analysisRevision, "", null], { items: pageOne, total: pageFindings.length, nextCursor: pageTwo.length ? "fixture-page-2" : null });
    client.setQueryData([...keys, "findings", record.id, record.token.analysisRevision, "", "fixture-page-2"], { items: pageTwo, total: pageFindings.length, nextCursor: null });
    for (const status of ["needs_review", "needs_correction"]) {
      const filtered = pageFindings.filter((item) => item.status === status);
      client.setQueryData([...keys, "findings", record.id, record.token.analysisRevision, status, null], { items: filtered, total: filtered.length, nextCursor: null });
    }
  };

  seedReview(needsReview, days, findings);
  seedReview(approved, approvedReviewDays, []);
  seedReview(failedAudit, [], []);
  client.setQueryData([...keys, "records", payDate, null], roster);
  client.setQueryData([...keys, "candidates", payDate, null], roster);
}
