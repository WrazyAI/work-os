import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fixture, access, interval, org, person } from "./helpers/work-os-admin-otto-fixture.mts";

// The break this catches: a system payroll approval being rendered, spoken or
// counted as an employee confirmation.
const shared = () => import("../src/modules/work-os/recap-review");
const recap = () => import("../src/lib/work-os-reviewed-recaps");

const row = (over: Record<string, unknown> = {}) => ({
  id: interval, organization_id: org, person_id: person, review_status: "confirmed",
  review_source: null, payroll_date: null, reviewed_at: "2026-11-16T06:05:00Z",
  window_start: "2026-10-21T09:00:00Z", window_end: "2026-10-21T10:00:00Z",
  timezone: "UTC", headline: "Review work", ai_detail: "Reviewed the queue.",
  final_detail: "Reviewed the queue.", employee_feedback: null, source_hash: "source-a",
  revision: 2, generated_at: "2026-10-21T10:01:00Z", structured_summary: {},
  ...over,
});

test("payroll_auto_is_not_employee_confirmation", async () => {
  const { recapReviewLabel, isEmployeeReviewedRecap, payrollRecapNotice, recapReviewSource, recapReviewActor } = await shared();
  assert.equal(recapReviewLabel("confirmed", "payroll_auto"), "Auto-approved for payroll");
  assert.equal(isEmployeeReviewedRecap("confirmed", "payroll_auto"), false);
  assert.equal(recapReviewLabel("confirmed", "employee"), "Confirmed by employee");
  assert.equal(recapReviewLabel("confirmed", undefined), "Confirmed by employee", "legacy payloads are employee-sourced");
  assert.equal(recapReviewLabel("amended", "employee"), "Corrected by employee");
  assert.equal(recapReviewLabel("amended", "admin"), "Corrected by administrator");
  assert.equal(recapReviewLabel("confirmed", "admin"), "Approved by administrator");
  assert.equal(recapReviewLabel("inferred"), "AI-inferred, not reviewed");
  assert.equal(recapReviewSource("inferred", "payroll_auto"), null);
  assert.equal(recapReviewSource("confirmed", null), "employee");
  assert.equal(recapReviewActor("confirmed", "payroll_auto"), "system");
  assert.equal(recapReviewActor("confirmed", "admin"), "administrator");
  assert.equal(recapReviewActor("amended", "employee"), "employee");
  assert.match(payrollRecapNotice("2026-11-16"), /2026-11-16/);
  assert.match(payrollRecapNotice("2026-11-16"), /not an employee confirmation/i);
  assert.throws(() => payrollRecapNotice("next Tuesday"), /date/i);
});

test("auto-approved recaps carry system provenance into immutable snapshots and speech", async () => {
  const { buildReviewedRecap } = await recap();
  const personRef = { id: person, displayName: "Ada", active: true, timezone: "UTC" };
  const auto = buildReviewedRecap(row({ review_source: "payroll_auto", payroll_date: "2026-11-16" }) as never, 2, "event-auto", personRef);
  assert.equal(auto.reviewSource, "payroll_auto");
  assert.equal(auto.payrollDate, "2026-11-16");
  assert.equal(auto.reviewStatus, "confirmed");
  assert.match(auto.coverage.join(" "), /system|auto-approved/i);
  assert.doesNotMatch(auto.coverage.join(" "), /employee reviewed/i);
  assert.ok(auto.speechLines.some((line) => /auto-approved for payroll/i.test(line.text)));
  assert.ok(auto.speechLines.some((line) => /not an employee confirmation/i.test(line.text)));
  assert.doesNotMatch(auto.speechLines.map((line) => line.text).join(" "), /employee confirmed/i);

  const legacy = buildReviewedRecap(row() as never, 2, "event-legacy", personRef);
  assert.equal(legacy.reviewSource, "employee");
  assert.equal(legacy.payrollDate, null);
  assert.match(legacy.coverage.join(" "), /employee reviewed/i);
  const amended = buildReviewedRecap(row({ review_status: "amended", employee_feedback: "Also checked logs." }) as never, 3, "event-amended", personRef);
  assert.equal(amended.reviewSource, "employee");
});

test("legacy snapshots normalize to employee without rewriting their payload", async () => {
  const { normalizeReviewedRecap } = await shared();
  const legacy = {
    intervalId: interval, eventId: "e", person: { id: person, displayName: "Ada", active: true, timezone: "UTC" },
    reviewVersion: 1, reviewKey: "k", sourceRevision: 1, scriptHash: "s", reviewStatus: "confirmed",
    reviewedAt: "2026-10-21T10:02:00Z", windowStart: "2026-10-21T09:00:00Z", windowEnd: "2026-10-21T10:00:00Z",
    timezone: "UTC", original: { headline: "h", detail: "d", activities: [] }, employeeFeedback: null,
    speechLines: [], coverage: [],
  } as const;
  const normalized = normalizeReviewedRecap(legacy);
  assert.equal(normalized.reviewSource, "employee");
  assert.equal(normalized.payrollDate, null);
  assert.equal((legacy as { reviewSource?: string }).reviewSource, undefined, "normalization must not mutate the stored payload");
});

test("next steps refuse a payroll-auto recap even though it is confirmed", async () => {
  const { nextStepsRecapEligible } = await shared();
  assert.equal(nextStepsRecapEligible("confirmed", "payroll_auto"), false);
  assert.equal(nextStepsRecapEligible("confirmed", "employee"), true);
  assert.equal(nextStepsRecapEligible("amended", "employee"), true);
  assert.equal(nextStepsRecapEligible("confirmed", "admin"), false);
  assert.equal(nextStepsRecapEligible("inferred", null), false);
});

test("an employee amendment after payroll auto writes a new employee version and preserves the auto event", async () => {
  const f = await fixture();
  try {
    await f.db.exec(await readFile(new URL("../supabase/migrations/0079_work_payroll_recap_provenance.sql", import.meta.url), "utf8"));
    await f.db.query("update work_activity_intervals set review_status='confirmed', review_source='payroll_auto', payroll_date='2026-11-16', reviewed_at='2026-11-16T06:05:00Z' where id=$1", [interval]);
    const { buildReviewedRecap } = await recap();
    const { rows } = await f.db.query("select * from work_activity_intervals where id=$1", [interval]);
    const auto = buildReviewedRecap(rows[0] as never, 1, "auto-event", { id: person, displayName: "Ada", active: true, timezone: "UTC" });
    await f.db.query(`insert into work_recap_reviews
      (id,organization_id,interval_id,person_id,version,event_sequence,review_key,source_revision,content_hash,script_hash,payload,reviewed_at,arrival_eligible,review_source,payroll_date)
      values('aaaaaaaa-0000-4000-8000-000000000001',$1,$2,$3,1,1,$4,1,'auto-hash',$5,$6::jsonb,'2026-11-16T06:05:00Z',true,'payroll_auto','2026-11-16')`,
    [org, interval, person, auto.reviewKey, auto.scriptHash, JSON.stringify(auto)]);
    await f.db.query("insert into work_admin_otto_clock(organization_id,sequence) values($1,1) on conflict (organization_id) do update set sequence=1", [org]);
    const { decideReviewedRecap } = await recap();
    const saved = await decideReviewedRecap(access, interval, { action: "amend", feedback: "Also checked the deploy logs.", expectedReviewVersion: 1 });
    assert.equal(saved.review_status, "amended");
    assert.equal(saved.review_source, "employee");
    assert.equal(saved.payroll_date, null);
    const versions = await f.db.query("select version,review_source,payroll_date,payload from work_recap_reviews order by version");
    const versionsRows = versions.rows as Array<Record<string, any>>;
    assert.equal(versionsRows.length, 2);
    assert.equal(versionsRows[0].review_source, "payroll_auto");
    assert.equal(versionsRows[0].payroll_date.toISOString?.().slice(0, 10) ?? String(versionsRows[0].payroll_date).slice(0, 10), "2026-11-16");
    assert.equal(versionsRows[0].payload.reviewSource, "payroll_auto", "the historical auto event is not rewritten");
    assert.equal(versionsRows[1].review_source, "employee");
    assert.equal(versionsRows[1].payroll_date, null);
    assert.equal(versionsRows[1].payload.reviewSource, "employee");
    const next = await f.db.query("select next_steps_status from work_activity_intervals where id=$1", [interval]);
    assert.equal((next.rows[0] as { next_steps_status: string }).next_steps_status, "pending", "an employee decision may start the normal next-step flow");
  } finally { await f.close(); }
});
