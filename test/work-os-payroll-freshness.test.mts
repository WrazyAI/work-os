import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import type { PoolClient } from "pg";

// The break this catches: approval reading a token before a source edit while
// the edit commits after validation, or a next-step/cache touch invalidating
// unchanged hours.
const freshness = () => import("../src/lib/work-os-payroll-freshness");
const scope = { organizationId: org, personId: person };
const client = (f: Awaited<ReturnType<typeof payrollFixture>>) => f.db as unknown as PoolClient;

test("calculation sources bump the fence; cache/next-step/expiry touches do not", async () => {
  const { loadPayrollSourceToken, verifyPayrollSourceToken } = await freshness();
  const f = await payrollFixture();
  try {
    await f.db.query(`insert into work_screenshot_summaries(id,organization_id,person_id,summary,expires_at)
      values('80000000-0000-4000-8000-000000000003',$1,$2,'Original observation','2026-11-01T00:00:00Z')`, [org, person]);
    const initial = await loadPayrollSourceToken(client(f), scope);
    await f.db.query("update work_activity_intervals set next_steps_status='pending' where id=(select id from work_activity_intervals limit 1)");
    await verifyPayrollSourceToken(client(f), scope, initial);

    await f.db.query("update work_sessions set organization_id=$1, person_id=$2, clocked_out_at='2026-10-21T10:00:00Z' where id=1", [org, person]);
    await assert.rejects(verifyPayrollSourceToken(client(f), scope, initial), /changed|reload/i);
    const afterSession = await loadPayrollSourceToken(client(f), scope);
    assert.notEqual(afterSession, initial);

    await f.db.query(`insert into work_recap_reviews
      (id,organization_id,interval_id,person_id,version,event_sequence,review_key,source_revision,content_hash,script_hash,payload,reviewed_at,arrival_eligible)
      values('bbbbbbbb-0000-4000-8000-000000000001',$1,'30000000-0000-4000-8000-000000000001',$2,1,99,'k',1,'h','s','{}','2026-10-21T10:00:00Z',false)`, [org, person]);
    await assert.rejects(verifyPayrollSourceToken(client(f), scope, afterSession), /changed|reload/i);
    const afterReview = await loadPayrollSourceToken(client(f), scope);

    await f.db.query("update work_screenshot_summaries set expires_at='2026-12-01T00:00:00Z' where id='80000000-0000-4000-8000-000000000003'");
    await verifyPayrollSourceToken(client(f), scope, afterReview);
    await f.db.query("update work_screenshot_summaries set summary='Changed observation' where id='80000000-0000-4000-8000-000000000003'");
    await assert.rejects(verifyPayrollSourceToken(client(f), scope, afterReview), /changed|reload/i);
    const afterSummary = await loadPayrollSourceToken(client(f), scope);

    await f.db.query(`insert into work_provider_connections(id,organization_id,provider,external_workspace_id,active)
      values('cccccccc-0000-4000-8000-000000000001',$1,'worktivity','workspace',true)`, [org]);
    const afterConnection = await loadPayrollSourceToken(client(f), scope);
    assert.notEqual(afterConnection, afterSummary);
    await f.db.query("update work_provider_connections set active=false where id='cccccccc-0000-4000-8000-000000000001'");
    await assert.rejects(verifyPayrollSourceToken(client(f), scope, afterConnection), /changed|reload/i);
  } finally { await f.close(); }
});
