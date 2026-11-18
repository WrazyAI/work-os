import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import { resolvePayrollPeriod } from "../src/lib/work-os-payroll-period";
import type { PayrollDayInput, PayrollSourceManifest, PayrollWeekSources } from "../src/modules/work-os/payroll/contracts";

// The break this catches: an image expiry or observation timestamp rewriting
// payable evidence, or a historical schedule being replaced by today's rules.
const sources = () => import("../src/lib/work-os-payroll-sources");
const scope = { organizationId: org, personId: person };
const period = resolvePayrollPeriod("2026-11-16", "UTC");
const day = (over: Partial<PayrollDayInput> = {}): PayrollDayInput => ({
  scope, date: "2026-11-05", week: 1, timezone: "UTC", sessions: [], breaks: [], pauseResidualMs: 0,
  captures: [], exceptions: [], frameSignals: [], frameCandidates: [], blockers: [], sourceHash: "day-a", ...over,
});
const week = (number: 1 | 2): PayrollWeekSources => ({
  scope, week: number, from: period.weeks[number - 1].from, through: period.weeks[number - 1].through,
  sourceHash: `week-${number}`, recaps: [{
    id: "interval-1", revision: 1, reviewVersion: 1, reviewSource: "employee",
    headline: "Reviewed the queue", detail: "Read the queue.", citations: [{ type: "interval", id: "interval-1", revision: 1 }],
  }], outcomes: [], gaps: [],
});
const manifest = (over: Partial<PayrollSourceManifest> = {}): PayrollSourceManifest => ({
  scope, period, asOf: "2026-11-16T06:05:00.000Z", sourceToken: "0:0", policyVersion: "payroll-sources-v1",
  days: [day()], weekSources: [week(1), week(2)], hash: "", rawImageExpiry: { "summary-1": "2026-12-01T00:00:00.000Z" }, ...over,
});

test("employee_amendment_invalidates_but_image_expiry_does_not_rewrite_sources", async () => {
  const { hashPayrollSources } = await sources();
  const before = manifest();
  const afterAmendment = manifest({
    weekSources: [
      { ...week(1), sourceHash: "week-1-changed", recaps: [{ ...week(1).recaps[0], reviewVersion: 2, reviewSource: "employee", detail: "Read the queue and the logs." }] },
      week(2),
    ],
  });
  const afterRawExpiryOnly = manifest({ rawImageExpiry: { "summary-1": null }, asOf: "2026-11-17T09:00:00.000Z" });
  assert.notEqual(hashPayrollSources(before), hashPayrollSources(afterAmendment));
  assert.equal(hashPayrollSources(before), hashPayrollSources(afterRawExpiryOnly));
  assert.equal(hashPayrollSources(before), before.hash || hashPayrollSources(before), "hash is deterministic");
});

test("the loader uses the historical schedule, exceptions and closed session stamps", async () => {
  const { loadPayrollSources } = await sources();
  const f = await payrollFixture();
  try {
    const schedule = "a0000000-0000-4000-8000-000000000001";
    await f.db.query(`insert into work_schedules(id,organization_id,person_id,timezone,days_of_week,shift_start,shift_end,break_windows,effective_from)
      values($1,$2,$3,'UTC','{1,2,3,4,5}','09:00','17:00','[{"start":"12:00","end":"12:30"}]','2026-01-01')`, [schedule, org, person]);
    await f.db.query(`insert into work_schedule_exceptions(organization_id,person_id,exception_date,kind,shift_start,shift_end)
      values($1,$2,'2026-11-03','changed_shift','10:00','18:00'),
            ($1,$2,'2026-11-07','working_day','09:00','12:00'),
            ($1,$2,'2026-11-04','leave',null,null)`, [org, person]);
    await f.db.query(`insert into work_sessions(id,organization_id,person_id,shift_date,state,clocked_in_at,clocked_out_at,
        scheduled_starts_at,scheduled_ends_at,schedule_id,correction_status)
      values(10,$1,$2,'2026-11-03','clocked_out','2026-11-03T10:00:00Z','2026-11-03T18:00:00Z',
        '2026-11-03T10:00:00Z','2026-11-03T18:00:00Z',$3,'original')`, [org, person, schedule]);
    const loaded = await loadPayrollSources(scope, period, new Date("2026-11-16T06:05:00Z"));
    const changed = loaded.days.find((item) => item.date === "2026-11-03")!;
    assert.equal(changed.sessions.length, 1);
    assert.equal(changed.sessions[0].eligible!.startMs, Date.parse("2026-11-03T10:00:00Z"));
    assert.equal(changed.sessions[0].eligible!.endMs, Date.parse("2026-11-03T19:00:00Z"));
    assert.ok(changed.breaks.some((item) => item.source === "scheduled" && item.span.startMs === Date.parse("2026-11-03T12:00:00Z")));
    assert.ok(loaded.days.some((item) => item.date === "2026-11-07"), "working_day adds Saturday");
    assert.ok(!loaded.days.some((item) => item.date === "2026-11-04"), "leave with no work is not a payable day");
    assert.ok(loaded.days.some((item) => item.date === "2026-11-05" && item.sessions.length === 0), "scheduled no-session day still exists");
    assert.equal(loaded.period.timezone, "UTC");
    assert.equal(loaded.policyVersion, "payroll-sources-v1");
  } finally { await f.close(); }
});

test("a mismatched session stamp blocks instead of silently trusting either window", async () => {
  const { loadPayrollSources } = await sources();
  const f = await payrollFixture();
  try {
    const schedule = "a0000000-0000-4000-8000-000000000002";
    await f.db.query(`insert into work_schedules(id,organization_id,person_id,timezone,days_of_week,shift_start,shift_end,effective_from)
      values($1,$2,$3,'UTC','{1,2,3,4,5}','09:00','17:00','2026-01-01')`, [schedule, org, person]);
    await f.db.query(`insert into work_sessions(id,organization_id,person_id,shift_date,state,clocked_in_at,clocked_out_at,
        scheduled_starts_at,scheduled_ends_at,schedule_id) values(11,$1,$2,'2026-11-05','clocked_out','2026-11-05T09:00:00Z','2026-11-05T17:00:00Z',
        '2026-11-05T08:00:00Z','2026-11-05T16:00:00Z',$3)`, [org, person, schedule]);
    const loaded = await loadPayrollSources(scope, period, new Date("2026-11-16T06:05:00Z"));
    const dayRow = loaded.days.find((item) => item.date === "2026-11-05")!;
    assert.ok(dayRow.blockers.some((line) => /stamp conflicts/i.test(line)));
  } finally { await f.close(); }
});

test("provider captures attach to the owning shift and incomplete paging blocks", async () => {
  const { buildPayrollDayInputs } = await sources();
  const shift = { startMs: Date.parse("2026-11-05T09:00:00Z"), endMs: Date.parse("2026-11-05T17:00:00Z") };
  const base = manifest({
    days: [day({ date: "2026-11-05", sessions: [{ id: "s1", recorded: shift, eligible: { startMs: shift.startMs, endMs: shift.endMs + 3_600_000 }, closed: true, scheduleSource: "session_stamp", correctionStatus: "original" }] })],
  });
  const provider = {
    scope, connectionId: "c", bounds: { startMs: shift.startMs, endMs: shift.endMs }, logs: [
      { id: "inside", employeeId: "e", capturedAt: "2026-11-05T10:00:00.000Z", span: { startMs: Date.parse("2026-11-05T10:00:00Z"), endMs: Date.parse("2026-11-05T10:01:00Z") }, activity: 30, zeroEligible: false, status: 1, app: "Editor", title: "Editor", domain: null, productivityCode: null },
      { id: "outside", employeeId: "e", capturedAt: "2026-11-09T10:00:00.000Z", span: { startMs: Date.parse("2026-11-09T10:00:00Z"), endMs: Date.parse("2026-11-09T10:01:00Z") }, activity: 30, zeroEligible: false, status: 1, app: "Editor", title: "Editor", domain: null, productivityCode: null },
    ], complete: false, watermark: "w1", verifiedAt: "2026-11-16T06:05:00Z",
    semantics: { version: "v1", verified: false, direction: "unknown" as const, durationMs: 60_000 },
    apps: { items: [], complete: true, coverage: [], enumLabels: {} },
  };
  const built = buildPayrollDayInputs(base, provider);
  assert.equal(built.find((item) => item.date === "2026-11-05")!.captures.length, 1);
  assert.ok(built.find((item) => item.date === "2026-11-05")!.blockers.some((line) => /incomplete/i.test(line)));
  assert.equal(built.find((item) => item.date === "2026-11-05")!.captures[0].id, "inside");
});

test("a timezone change cannot move the frozen period dates", async () => {
  const { loadPayrollSources } = await sources();
  const f = await payrollFixture();
  try {
    await f.db.query(`insert into work_schedules(id,organization_id,person_id,timezone,days_of_week,shift_start,shift_end,effective_from)
      values('a0000000-0000-4000-8000-000000000003',$1,$2,'UTC','{1,2,3,4,5}','09:00','17:00','2026-01-01')`, [org, person]);
    const first = await loadPayrollSources(scope, period, new Date("2026-11-16T06:05:00Z"));
    await f.db.query("update work_people set timezone='America/New_York' where id=$1", [person]);
    await f.db.query("insert into work_employee_onboarding(organization_id,person_id,timezone) values($1,$2,'America/New_York')", [org, person]);
    const second = await loadPayrollSources(scope, period, new Date("2026-11-16T06:05:00Z"));
    assert.deepEqual(second.period.weeks, first.period.weeks);
    assert.deepEqual(second.days.map((item) => item.date), first.days.map((item) => item.date));
  } finally { await f.close(); }
});
