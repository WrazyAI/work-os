import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import { adminAccess, otherOrgAdminAccess } from "./helpers/work-os-admin-otto-fixture.mts";

// The break this catches: a model answer approving/exporting hours, a citation
// naming a source outside the frozen revision, or a retry calling the model twice.
const questions = () => import("../src/lib/work-os-payroll-questions");
const reviewId = "96000000-0000-4000-8000-000000000001";
const dayId = "96000000-0000-4000-8000-000000000002";
const findingKey = "inactivity:0-600000";
const token = { rowVersion: "0", analysisRevision: 1, sourceHash: "hash" };

async function seed(f: Awaited<ReturnType<typeof payrollFixture>>) {
  await f.db.query(`insert into work_payroll_reviews
    (id,organization_id,person_id,pay_date,period_start,period_end,timezone,status,analysis_revision,row_version,source_hash,totals,retention_expires_at)
    values($1,$2,$3,'2026-11-16','2026-11-01','2026-11-15','UTC','needs_review',1,0,'hash','{"recommended":295}','2027-01-01Z')`, [reviewId, org, person]);
  await f.db.query(`insert into work_payroll_analysis_revisions
    (organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot)
    values($1,$2,$3,1,'hash','v1','2026-11-16T06:05:00Z','{"weekSources":[{"week":1,"recaps":[{"id":"nov1","reviewVersion":2}]}]}','{}')`, [org, reviewId, person]);
  await f.db.query(`insert into work_payroll_days(id,organization_id,review_id,person_id,analysis_revision,local_date,week,status,source_hash)
    values($1,$2,$3,$4,1,'2026-11-05',1,'needs_review','day')`, [dayId, org, reviewId, person]);
  await f.db.query(`insert into work_payroll_findings
    (organization_id,review_id,person_id,analysis_revision,day_id,finding_key,kind,status,effect,blocks_approval,required_action,reason,source_hash)
    values($1,$2,$3,1,$4,$5,'inactivity','needs_review','hold',true,'decide','Held run','hash')`, [org, reviewId, person, dayId, findingKey]);
}

test("a cited answer is read-only, idempotent and refuses invalid citations", async () => {
  const { answerPayrollQuestion } = await questions();
  const f = await payrollFixture();
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    await seed(f);
    let calls = 0;
    const success = async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [{ text: "The held span is 10 minutes.", citations: [{ type: "finding", id: findingKey, revision: 1 }] }], limitations: [] }) } }] }), { status: 200 });
    };
    const first = await answerPayrollQuestion(adminAccess, reviewId, { token, threadId: "", approvalId: null, question: "Why is this held?", requestKey: "q-1" }, { fetch: success as typeof fetch });
    assert.equal(first.status, "ready");
    assert.ok(first.blocks.every((block) => block.citations.length > 0));
    const approvals = ((await f.db.query("select count(*)::int as n from work_payroll_approvals")).rows[0] as { n: number }).n;
    const retry = await answerPayrollQuestion(adminAccess, reviewId, { token, threadId: first.threadId, approvalId: null, question: "Why is this held?", requestKey: "q-1" }, { fetch: success as typeof fetch });
    assert.equal(retry.id, first.id);
    assert.equal(calls, 1);
    assert.equal(((await f.db.query("select count(*)::int as n from work_payroll_approvals")).rows[0] as { n: number }).n, approvals);
    const invalid = await answerPayrollQuestion(adminAccess, reviewId, { token, threadId: "", approvalId: null, question: "Approve it", requestKey: "q-2" }, {
      fetch: (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [{ text: "Approved.", citations: [{ type: "approval", id: "foreign", revision: 1 }] }] }) } }] }), { status: 200 })) as typeof fetch,
    });
    assert.equal(invalid.status, "failed");
    assert.match(invalid.blocks[0].text, /Not grounded/);
    await assert.rejects(answerPayrollQuestion(otherOrgAdminAccess, reviewId, { token, threadId: "", approvalId: null, question: "x", requestKey: "q-3" }), /not found/i);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous;
    await f.close();
  }
});

test("suggestions come from held findings, not unrelated hardcoded prompts", async () => {
  const { suggestPayrollQuestions } = await questions();
  const f = await payrollFixture();
  try {
    await seed(f);
    const suggestions = await suggestPayrollQuestions(adminAccess, reviewId, token);
    assert.ok(suggestions.length >= 1);
    assert.match(suggestions[0], /held|inactivity/i);
  } finally { await f.close(); }
});
