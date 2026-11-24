import type { QueryClient } from "@tanstack/react-query";
import type { PayrollDayResult, PayrollFinding, PayrollPeriod, PayrollReview, PayrollRosterPage } from "../../../../../src/modules/work-os/payroll/contracts";
import { defaultPayDate } from "./PayrollPage";
import { desktopPayrollKey } from "./api";

function dateOffset(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function seedPayrollPreview(client: QueryClient, session: { organizationId: string; userId: string }, empty: boolean) {
  const payDate = defaultPayDate();
  const through = dateOffset(payDate, -1);
  const from = payDate.endsWith("-16") ? `${payDate.slice(0, 7)}-01` : `${through.slice(0, 7)}-16`;
  const period: PayrollPeriod = {
    payDate, from, through, timezone: "UTC",
    weeks: [{ week: 1, from, through: dateOffset(from, 6) }, { week: 2, from: dateOffset(from, 7), through }],
  };
  const keys = desktopPayrollKey(session.organizationId, session.userId);
  const totals = { recorded: 1898, eligibleTracked: 1886, outside: 12, break: 145, inactivity: 0, held: 9, manualExcluded: 0, recommended: 1732, approved: 0 };
  const employee = { reviewId: "fixture-payroll-audit", personId: "fixture-payroll-person", displayName: "Ada Okafor", active: true, mapped: true, status: "needs_review", auditStatus: "done" as const, totals, workdays: 6 };
  const second = { ...employee, personId: "fixture-payroll-second", reviewId: null, displayName: "Luis Moreno", status: "not_started" };
  const roster: PayrollRosterPage = { items: empty ? [] : [employee], total: empty ? 0 : 1, nextCursor: null, period,
    counts: empty ? {} : { needs_review: 1 } };
  client.setQueryData([...keys, "records", payDate, null], roster);
  client.setQueryData([...keys, "candidates", payDate, null], { ...roster, items: empty ? [] : [employee, second], total: empty ? 0 : 2 });
  const scope = { organizationId: session.organizationId, personId: employee.personId };
  const date = dateOffset(from, 2);
  const citation = { type: "interval" as const, id: "fixture-recap-724", revision: 2 };
  const review: PayrollReview = { id: employee.reviewId, scope, period, status: "needs_review", totals,
    token: { rowVersion: "1", analysisRevision: 1, sourceHash: "fixture-current" },
    briefs: [{ week: 1, status: "ready", title: "Release readiness", summary: "Updated the runbook, checked the deployment path, and prepared the handoff.",
      summaryCitations: [citation], themes: [{ heading: "Deployment checks", detail: "Verified the staging sequence and recorded the rollback checklist.", citations: [citation] }],
      openItems: [{ text: "Confirm the rollout owner before the next release.", citations: [citation] }],
      gaps: ["One recording window had incomplete coverage."], sourceHash: "fixture-week" }],
    blockers: [], run: null, approval: null, retentionExpiresAt: `${dateOffset(payDate, 30)}T00:00:00Z`,
    firstExportAt: null, evidenceChangedSinceApproval: false, providerVerifiedAt: `${date}T17:00:00Z`,
    recapStats: { employeeReviewed: 12, autoApproved: 4, pending: 0 } };
  const finding: PayrollFinding = { id: "fixture-finding", key: "inactivity:fixture", scope, dayId: "fixture-day", date,
    kind: "inactivity", status: "needs_review", effect: "hold", span: null, durationMs: 540000, minutes: 9,
    sourceHash: "fixture-day", blocksApproval: true, requiredAction: "decide",
    reason: "Activity was recorded as zero for this interval. The available evidence does not establish whether this was work time.", citations: [citation] };
  const day: PayrollDayResult = { id: "fixture-day", scope, date, week: 1, partition: [], exactMs: { payable: 0, break: 0, inactivity: 0, held: 540000, manual: 0, outside: 0 },
    minutes: { ...totals, recorded: 389, eligibleTracked: 389, outside: 0, break: 30, recommended: 350 }, findings: [finding], blockers: [],
    sourceHash: "fixture-day", decisionKeys: [], evidence: { scheduleSource: "historical_schedule", sampledFrames: 3,
      sessions: [{ recorded: { startMs: Date.parse(`${date}T09:00:00Z`), endMs: Date.parse(`${date}T15:29:00Z`) }, eligible: null }] } };
  client.setQueryData([...keys, "review", employee.reviewId], review);
  client.setQueryData([...keys, "days", employee.reviewId, 1], { items: [day], total: 1, nextCursor: null });
  for (const status of ["", "needs_review", "needs_correction"]) {
    const included = status !== "needs_correction";
    client.setQueryData([...keys, "findings", employee.reviewId, 1, status, null],
      { items: included ? [finding] : [], total: included ? 1 : 0, nextCursor: null });
  }
}
