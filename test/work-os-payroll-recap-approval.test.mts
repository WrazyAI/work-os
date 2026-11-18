import assert from "node:assert/strict";
import test from "node:test";
import { resolvePayrollPeriod } from "../src/lib/work-os-payroll-period";
import { payrollFixture, org, person, otherOrg, otherPerson } from "./helpers/work-os-payroll-fixture.mts";

// The break these catches: approving yesterday's or next period's recaps,
// fabricating employee confirmation, or double-writing a system version.
const approval = () => import("../src/lib/work-os-payroll-recap-approval");
type Fixture = Awaited<ReturnType<typeof payrollFixture>>;
const payrollMorning = new Date("2026-11-16T06:05:00Z");

async function settings(f: Fixture, organizationId = org, activation = "2026-10-01T00:00:00Z") {
  await f.db.query(`insert into work_payroll_settings
    (organization_id,enabled,auto_approve_enabled,cutoff_hour,auto_approve_activated_at)
    values($1,true,true,6,$2)
    on conflict (organization_id) do update set enabled=true,auto_approve_enabled=true,cutoff_hour=6,auto_approve_activated_at=$2`,
  [organizationId, activation]);
}
let sequence = 0;
async function addInterval(f: Fixture, input: {
  localDate: string; organizationId?: string; personId?: string; generation?: string;
  windowStart?: string; windowEnd?: string; detail?: string;
}) {
  sequence += 1;
  const id = `70000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  const organizationId = input.organizationId ?? org;
  const personId = input.personId ?? person;
  const at = input.windowStart ?? `${input.localDate}T12:00:00Z`;
  const end = input.windowEnd ?? `${input.localDate}T13:00:00Z`;
  await f.db.query(`insert into work_activity_intervals
    (id,organization_id,person_id,local_date,generation_status,review_status,headline,ai_detail,final_detail,
     structured_summary,source_hash,revision,window_start,window_end,timezone,generated_at,next_steps_status)
    values($1,$2,$3,$4,$5,'inferred','Headline',$6,$6,'{}','source',1,$7,$8,'UTC',$7,'not_requested')`,
  [id, organizationId, personId, input.localDate, input.generation ?? "ready", input.detail ?? "Detail", at, end]);
  return id;
}
async function nonRecapState(f: Fixture) {
  return (await f.db.query(`select
    (select count(*)::int from work_check_ins) as check_ins,
    (select count(*)::int from work_sessions) as sessions,
    (select last_substantive_update_at from work_sessions where id=1) as last_substantive,
    (select count(*)::int from work_tasks) as tasks`)).rows[0] as Record<string, unknown>;
}
const one = async (f: Fixture, sql: string, params?: unknown[]) =>
  (await f.db.query(sql, params)).rows[0] as Record<string, unknown>;

test("the 16th approves only the first half, and the 1st only the previous second half", async () => {
  const { ensurePayrollRecapApproval } = await approval();
  const f = await payrollFixture();
  try {
    await settings(f);
    const first = await addInterval(f, { localDate: "2026-11-01" });
    const last = await addInterval(f, { localDate: "2026-11-15" });
    const next = await addInterval(f, { localDate: "2026-11-16" });
    await addInterval(f, { localDate: "2026-10-31" });
    const before = await nonRecapState(f);
    const period = resolvePayrollPeriod("2026-11-16", "UTC");
    const result = await ensurePayrollRecapApproval({ organizationId: org, personId: person }, period, payrollMorning, 100);
    assert.equal(result.approved, 2);
    assert.equal(result.complete, true);
    assert.equal(result.pending, 0);
    const rows = (await f.db.query(`select interval_id,review_source,payroll_date from work_recap_reviews order by interval_id`)).rows as Array<Record<string, unknown>>;
    assert.deepEqual(new Set(rows.map((row) => row.interval_id)), new Set([first, last]));
    assert.ok(rows.every((row) => row.review_source === "payroll_auto"));
    assert.ok(rows.every((row) => (row.payroll_date instanceof Date ? row.payroll_date.toISOString() : String(row.payroll_date)).slice(0, 10) === "2026-11-16"));
    assert.equal((await one(f, "select review_status,review_source,payroll_date,next_steps_status,employee_feedback,final_detail from work_activity_intervals where id=$1", [first])).review_source, "payroll_auto");
    assert.equal((await one(f, "select next_steps_status from work_activity_intervals where id=$1", [first])).next_steps_status, "skipped");
    assert.equal((await one(f, "select review_status from work_activity_intervals where id=$1", [next])).review_status, "inferred");
    assert.equal((await one(f, "select count(*)::int as n from work_recap_reviews where interval_id=$1", [next])).n, 0);
    assert.deepEqual(await nonRecapState(f), before, "auto approval never creates check-ins or task/cadence side effects");

    const repeat = await ensurePayrollRecapApproval({ organizationId: org, personId: person }, period, payrollMorning, 100);
    assert.equal(repeat.approved, 0);
    assert.equal((await one(f, "select count(*)::int as n from work_recap_reviews where interval_id=$1", [first])).n, 1);

    const october = resolvePayrollPeriod("2026-11-01", "UTC");
    const octoberResult = await ensurePayrollRecapApproval({ organizationId: org, personId: person }, october, new Date("2026-11-01T06:05:00Z"), 100);
    assert.equal(octoberResult.approved, 2);
    assert.equal((await one(f, "select review_source from work_activity_intervals where local_date='2026-10-31'")).review_source, "payroll_auto");
    assert.equal((await one(f, "select review_status from work_activity_intervals where local_date='2026-11-01'")).review_status, "confirmed");
  } finally { await f.close(); }
});

test("the cutoff is the employee-local 06:00 and a late run catches up", async () => {
  const { ensurePayrollRecapApproval } = await approval();
  const f = await payrollFixture();
  try {
    await settings(f);
    const id = await addInterval(f, { localDate: "2026-11-05" });
    const period = resolvePayrollPeriod("2026-11-16", "UTC");
    const before = await ensurePayrollRecapApproval({ organizationId: org, personId: person }, period, new Date("2026-11-16T05:59:59Z"), 100);
    assert.equal(before.approved, 0);
    assert.equal(before.complete, false);
    assert.equal((await one(f, "select review_status from work_activity_intervals where id=$1", [id])).review_status, "inferred");
    const after = await ensurePayrollRecapApproval({ organizationId: org, personId: person }, period, new Date("2026-11-18T11:00:00Z"), 100);
    assert.equal(after.approved, 1);
    assert.equal(after.complete, true);
  } finally { await f.close(); }
});

test("only ready inferred recaps are approved, and overnight membership follows the shift date", async () => {
  const { ensurePayrollRecapApproval } = await approval();
  const f = await payrollFixture();
  try {
    await settings(f);
    const overnight = await addInterval(f, { localDate: "2026-11-15", windowStart: "2026-11-15T22:00:00Z", windowEnd: "2026-11-16T02:00:00Z" });
    const preparing = await addInterval(f, { localDate: "2026-11-07", generation: "preparing" });
    const failed = await addInterval(f, { localDate: "2026-11-08", generation: "failed" });
    const period = resolvePayrollPeriod("2026-11-16", "UTC");
    const result = await ensurePayrollRecapApproval({ organizationId: org, personId: person }, period, payrollMorning, 100);
    assert.equal(result.approved, 1);
    assert.equal((await one(f, "select review_status from work_activity_intervals where id=$1", [overnight])).review_status, "confirmed");
    for (const id of [preparing, failed]) {
      assert.equal((await one(f, "select review_status from work_activity_intervals where id=$1", [id])).review_status, "inferred");
      assert.equal((await one(f, "select count(*)::int as n from work_recap_reviews where interval_id=$1", [id])).n, 0);
    }
  } finally { await f.close(); }
});

test("an inactive person with period evidence is still settled", async () => {
  const { ensurePayrollRecapApproval } = await approval();
  const f = await payrollFixture();
  try {
    await settings(f);
    await f.db.query("update work_people set active=false where id=$1", [person]);
    const id = await addInterval(f, { localDate: "2026-11-09" });
    const period = resolvePayrollPeriod("2026-11-16", "UTC");
    const result = await ensurePayrollRecapApproval({ organizationId: org, personId: person }, period, payrollMorning, 100);
    assert.equal(result.approved, 1);
    assert.equal((await one(f, "select review_status from work_activity_intervals where id=$1", [id])).review_status, "confirmed");
  } finally { await f.close(); }
});

test("bounded slices page by stable ids to a complete settlement", async () => {
  const { ensurePayrollRecapApproval } = await approval();
  const f = await payrollFixture();
  try {
    await settings(f, otherOrg);
    const ids = [
      await addInterval(f, { localDate: "2026-11-10", organizationId: otherOrg, personId: otherPerson }),
      await addInterval(f, { localDate: "2026-11-11", organizationId: otherOrg, personId: otherPerson }),
      await addInterval(f, { localDate: "2026-11-12", organizationId: otherOrg, personId: otherPerson }),
    ];
    const period = resolvePayrollPeriod("2026-11-16", "UTC");
    const scope = { organizationId: otherOrg, personId: otherPerson };
    const first = await ensurePayrollRecapApproval(scope, period, payrollMorning, 2);
    assert.equal(first.approved, 2);
    assert.equal(first.complete, false);
    assert.equal(first.pending, 1);
    const second = await ensurePayrollRecapApproval(scope, period, payrollMorning, 2);
    assert.equal(second.approved, 1);
    assert.equal(second.complete, true);
    assert.equal((await one(f, "select count(*)::int as n from work_recap_reviews where interval_id=any($1::uuid[])", [ids])).n, 3);
  } finally { await f.close(); }
});

test("a failed audit rolls back the interval, review ledger and settlement", async () => {
  const { ensurePayrollRecapApproval } = await approval();
  const f = await payrollFixture();
  try {
    await settings(f);
    const id = await addInterval(f, { localDate: "2026-11-05" });
    await f.db.exec(`create function reject_payroll_audit() returns trigger language plpgsql as $$ begin raise exception 'audit rejected'; end $$;
      create trigger reject_payroll_audit before insert on work_audit_log for each row execute function reject_payroll_audit();`);
    const period = resolvePayrollPeriod("2026-11-16", "UTC");
    await assert.rejects(ensurePayrollRecapApproval({ organizationId: org, personId: person }, period, payrollMorning, 100), /audit rejected/);
    assert.equal((await one(f, "select review_status,review_source from work_activity_intervals where id=$1", [id])).review_status, "inferred");
    assert.equal((await one(f, "select count(*)::int as n from work_recap_reviews")).n, 0);
    assert.equal((await one(f, "select count(*)::int as n from work_payroll_recap_settlements")).n, 0);
  } finally { await f.close(); }
});

test("the service route authenticates the cron bearer in constant time", async () => {
  const { payrollCronAuthorized } = await approval();
  const previous = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "payroll-secret";
    assert.equal(payrollCronAuthorized(new Request("http://localhost", { headers: { authorization: "Bearer payroll-secret" } })), true);
    assert.equal(payrollCronAuthorized(new Request("http://localhost", { headers: { authorization: "Bearer wrong" } })), false);
    assert.equal(payrollCronAuthorized(new Request("http://localhost")), false);
    delete process.env.CRON_SECRET;
    assert.equal(payrollCronAuthorized(new Request("http://localhost", { headers: { authorization: "Bearer " } })), false);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("settlement catches up due periods without sweeping before activation", async () => {
  const { settleDuePayrollRecapApprovals } = await approval();
  const f = await payrollFixture();
  try {
    await settings(f, org, "2026-10-01T00:00:00Z");
    const october = await addInterval(f, { localDate: "2026-10-20" });
    const november = await addInterval(f, { localDate: "2026-11-05" });
    const old = await addInterval(f, { localDate: "2026-09-20" });
    const progress = await settleDuePayrollRecapApprovals({ at: payrollMorning, limit: 100 });
    assert.equal(progress.status, "done");
    assert.ok(progress.message.includes("recap"));
    assert.equal((await one(f, "select review_source from work_activity_intervals where id=$1", [october])).review_source, "payroll_auto");
    assert.equal((await one(f, "select review_source from work_activity_intervals where id=$1", [november])).review_source, "payroll_auto");
    assert.equal((await one(f, "select review_status from work_activity_intervals where id=$1", [old])).review_status, "inferred");
  } finally { await f.close(); }
});
