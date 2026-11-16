import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, payrollMigration, seedPayroll, org, person, otherOrg, otherPerson } from "./helpers/work-os-payroll-fixture.mts";

// Removing composite keys or immutable guards must fail these real DDL probes.
test("payroll_schema_is_idempotent_scoped_and_immutable", async () => {
  const f = await payrollFixture();
  try {
    await f.db.exec(await payrollMigration());
    assert.equal((await f.db.query<{n:number}>("select count(*)::int as n from pg_tables where tablename='work_payroll_reviews'")).rows[0].n, 1);
    const { reviewId, approvalId, dayId } = await seedPayroll(f);
    await assert.rejects(f.db.query("update work_payroll_approvals set approved_minutes = 0 where id = $1", [approvalId]), /immutable/i);
    await assert.rejects(f.db.query("delete from work_payroll_approvals where id=$1", [approvalId]), /immutable/i);
    await assert.rejects(f.db.query("delete from work_people where id=$1",[person]), /foreign key/i);
    await assert.rejects(f.db.query("delete from work_organizations where id=$1",[org]), /foreign key/i);
    await assert.rejects(f.db.query(`insert into work_payroll_days(organization_id,review_id,person_id,analysis_revision,local_date,week,source_hash)
      values($1,$2,$3,1,'2026-11-02',1,'a')`, [otherOrg,reviewId,otherPerson]), /foreign key/i);
    await assert.rejects(f.db.query(`insert into work_payroll_findings(organization_id,review_id,person_id,analysis_revision,day_id,finding_key,kind,status,effect,required_action,reason,source_hash)
      values($1,$2,$3,2,$4,'wrong-rev','no_work','needs_review','acknowledge','acknowledge','x','a')`,[org,reviewId,person,dayId]), /foreign key/i);
    const decision = `insert into work_payroll_decisions(organization_id,review_id,person_id,analysis_revision,finding_key,source_hash,decision,reason,actor_user_id,expected_row_version,idempotency_key)
      values($1,$2,$3,1,'gap-1','source-a','acknowledged','Checked source coverage',$3,0,'decision-1')`;
    await f.db.query(decision,[org,reviewId,person]);
    await assert.rejects(f.db.query(decision,[org,reviewId,person]), /unique/i);
    await assert.rejects(f.db.query("update work_payroll_decisions set reason='rewrite'"), /immutable/i);
    await assert.rejects(f.db.query("delete from work_payroll_decisions"), /immutable/i);
    await assert.rejects(f.db.query(`insert into work_payroll_analysis_revisions(organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot)
      values($1,$2,$3,1,'b','v1',now(),'{}','{}')`,[org,reviewId,person]), /unique/i);
    for (const values of [
      ['2026-11-02','2026-10-16','2026-10-31'],
      ['2026-11-16','2026-11-02','2026-11-15'],
      ['2027-03-01','2027-02-16','2027-02-27'],
    ]) await assert.rejects(f.db.query(`insert into work_payroll_reviews(organization_id,person_id,pay_date,period_start,period_end,timezone,retention_expires_at)
      values($1,$2,$3,$4,$5,'UTC',now()+interval '30 days')`,[org,person,...values]), /check/i);
    await f.db.query(`insert into work_payroll_runs(organization_id,review_id,person_id,target_revision,request_key) values($1,$2,$3,2,'run-1')`,[org,reviewId,person]);
    await assert.rejects(f.db.query(`insert into work_payroll_runs(organization_id,review_id,person_id,target_revision,request_key) values($1,$2,$3,2,'run-2')`,[org,reviewId,person]), /unique/i);
    for (const role of ['anon','authenticated']) {
      await f.db.exec(`set role ${role}`);
      try {
        await assert.rejects(f.db.query("select * from work_payroll_reviews"),/permission denied/i);
        await assert.rejects(f.db.query("select work_payroll_purge_expired($1,$2)",[org,reviewId]),/permission denied/i);
      } finally { await f.db.exec("reset role"); }
    }
    const grants = await f.db.query<{n:number}>(`select count(*)::int as n from information_schema.table_privileges where table_name like 'work_payroll_%' and grantee='PUBLIC'`);
    assert.equal(grants.rows[0].n,0);
    assert.equal((await f.db.query<{n:number}>(`select count(*)::int as n from work_payroll_settings where enabled or auto_approve_enabled`)).rows[0].n,0);
  } finally { await f.close(); }
});

test("only the expiry-checked maintenance function can purge payroll receipts", async () => {
  const f = await payrollFixture();
  try {
    const { reviewId } = await seedPayroll(f);
    // Use far-future expiry so this test has no wall-clock dependency.
    await f.db.query("update work_payroll_reviews set retention_expires_at='2100-01-01Z' where id=$1",[reviewId]);
    await assert.rejects(f.db.query("select work_payroll_purge_expired($1,$2)",[org,reviewId]),/not expired/i);
    await assert.rejects(f.db.query("select work_payroll_purge_expired($1,$2)",[otherOrg,reviewId]),/not found/i);
    await f.db.query("update work_payroll_reviews set retention_expires_at='2000-01-01Z' where id=$1",[reviewId]);
    await assert.rejects(f.db.query("delete from work_payroll_reviews where id=$1",[reviewId]),/maintenance/i);
    await f.db.query("select work_payroll_purge_expired($1,$2)",[org,reviewId]);
    assert.equal((await f.db.query<{n:number}>("select count(*)::int as n from work_payroll_approvals")).rows[0].n,0);
    assert.equal((await f.db.query<{n:number}>("select count(*)::int as n from work_people where id=$1",[person])).rows[0].n,1);
    assert.equal((await f.db.query<{n:number}>("select count(*)::int as n from work_activity_intervals")).rows[0].n,1);
  } finally { await f.close(); }
});

test("payroll transactions verify the scoped person and release on rollback", async () => {
  const f = await payrollFixture();
  try {
    const { withPayrollTransaction, assertPayrollOwner } = await import('../src/lib/work-os-payroll-store');
    const { reviewId } = await seedPayroll(f);
    await withPayrollTransaction({organizationId:org,personId:person}, async client => assertPayrollOwner(client,{organizationId:org,personId:person},reviewId));
    await assert.rejects(withPayrollTransaction({organizationId:otherOrg,personId:person},async () => {}),/not found/i);
    await assert.rejects(withPayrollTransaction({organizationId:otherOrg,personId:otherPerson},async client => assertPayrollOwner(client,{organizationId:otherOrg,personId:otherPerson},reviewId)),/not found/i);
    assert.equal(f.releases(),3);
  } finally { await f.close(); }
});

test("documented operator holds prevent expiry purge and browser roles cannot set holds", async () => {
  const f = await payrollFixture();
  try {
    const { reviewId } = await seedPayroll(f);
    await f.db.query("update work_payroll_reviews set retention_expires_at='2000-01-01Z' where id=$1",[reviewId]);
    await f.db.query(`insert into work_payroll_operator_holds(organization_id,review_id,person_id,reason,operator_reference)
      values($1,$2,$3,'Documented preservation order','operator-ticket-1')`,[org,reviewId,person]);
    await assert.rejects(f.db.query("select work_payroll_purge_expired($1,$2)",[org,reviewId]),/legal hold/i);
    await f.db.exec('set role authenticated');
    try { await assert.rejects(f.db.query('delete from work_payroll_operator_holds'),/permission denied/i); }
    finally { await f.db.exec('reset role'); }
  } finally { await f.close(); }
});

test("payroll PostgreSQL helper refuses non-disposable and remote database targets", async () => {
  const { disposablePayrollTarget } = await import('./helpers/work-os-payroll-postgres.mts');
  assert.throws(() => disposablePayrollTarget({}),/explicit/i);
  assert.throws(() => disposablePayrollTarget({WORK_OS_TEST_POSTGRES_URL:'postgres://localhost/work_os_test'}),/explicit/i);
  assert.throws(() => disposablePayrollTarget({WORK_OS_TEST_POSTGRES_URL:'postgres://remote.example/work_os_test',WORK_OS_TEST_POSTGRES_DISPOSABLE:'1'}),/loopback/i);
  assert.throws(() => disposablePayrollTarget({WORK_OS_TEST_POSTGRES_URL:'postgres://localhost/production',WORK_OS_TEST_POSTGRES_DISPOSABLE:'1'}),/disposable.*name/i);
  assert.equal(disposablePayrollTarget({WORK_OS_TEST_POSTGRES_URL:'postgres://localhost/work_os_test',WORK_OS_TEST_POSTGRES_DISPOSABLE:'1'}).hostname,'localhost');
  assert.throws(() => disposablePayrollTarget({WORK_OS_TEST_POSTGRES_URL:'postgres://localhost/work_os_test?host=remote.example',WORK_OS_TEST_POSTGRES_DISPOSABLE:'1'}),/option/i);
});

test("payroll rows reject invalid spans, negative durations and foreign screenshot ownership", async () => {
  const f = await payrollFixture();
  try {
    const { reviewId,dayId } = await seedPayroll(f);
    await assert.rejects(f.db.query('update work_payroll_days set eligible_ms=1,recorded_ms=0 where id=$1',[dayId]),/check/i);
    await assert.rejects(f.db.query('update work_payroll_days set recorded_ms=-1 where id=$1',[dayId]),/check/i);
    await assert.rejects(f.db.query("update work_payroll_findings set start_at='2026-11-01T10:00Z',end_at='2026-11-01T09:00Z'"),/check/i);
    const eventA='80000000-0000-4000-8000-000000000001', eventB='80000000-0000-4000-8000-000000000002', summary='80000000-0000-4000-8000-000000000003';
    await f.db.query('insert into work_evidence_events(id,organization_id,person_id) values($1,$2,$3),($4,$5,$6)',[eventA,org,person,eventB,otherOrg,otherPerson]);
    await f.db.query('insert into work_screenshot_summaries(id,organization_id,person_id,evidence_event_id) values($1,$2,$3,$4)',[summary,org,person,eventA]);
    const frame = `insert into work_payroll_frame_findings(organization_id,review_id,person_id,analysis_revision,day_id,screenshot_summary_id,evidence_event_id,captured_at,category,confidence,reason,model,prompt_version,rubric_hash,classification_key,source_hash,policy_hash)
      values($1,$2,$3,1,$4,$5,$6,now(),'unclear',0.5,'Ambiguous','model','v1','rubric','key','source-a','policy')`;
    await assert.rejects(f.db.query(frame,[org,reviewId,person,dayId,summary,eventB]),/foreign key/i);
    await f.db.query(frame,[org,reviewId,person,dayId,summary,eventA]);
    // Cache must never extend retention of the original screenshot/evidence.
    await f.db.query('delete from work_screenshot_summaries where id=$1',[summary]);
    assert.equal((await f.db.query<{n:number}>('select count(*)::int as n from work_payroll_frame_findings')).rows[0].n,0);
  } finally { await f.close(); }
});

test("payroll schema supports independent real PostgreSQL clients", {
  skip: !process.env.WORK_OS_TEST_POSTGRES_URL || process.env.WORK_OS_TEST_POSTGRES_DISPOSABLE!=='1'
    ? 'Requires explicit disposable loopback PostgreSQL; PGlite cannot prove locks.' : false,
}, async () => {
  const { withDisposablePayrollPostgres } = await import('./helpers/work-os-payroll-postgres.mts');
  await withDisposablePayrollPostgres(async ({pool}) => {
    const a=await pool.connect(),b=await pool.connect();
    try {
      const first=await a.query('select pg_backend_pid() as pid'),second=await b.query('select pg_backend_pid() as pid');
      assert.notEqual(first.rows[0].pid,second.rows[0].pid);
    } finally { a.release(); b.release(); }
  });
});
