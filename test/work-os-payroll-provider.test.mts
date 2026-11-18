import assert from "node:assert/strict";
import test from "node:test";
import type { CaptureSemantics, PayrollScope, Span } from "../src/modules/work-os/payroll/contracts";
import { payrollFixture, org, otherOrg, person, otherPerson } from "./helpers/work-os-payroll-fixture.mts";

// The break this catches: provider rows that are actually another employee, a
// null sample treated as zero, or a signed screenshot URL copied into payroll.
const provider = () => import("../src/lib/work-os-payroll-provider");
const employee = "emp-1";
const startMs = Date.parse("2026-11-02T00:00:00Z");
const bounds: Span = { startMs, endMs: startMs + 15 * 86_400_000 };
const semantics = (over: Partial<CaptureSemantics> = {}): CaptureSemantics => ({
  version: "worktivity-activitylog-v1", verified: true, direction: "start", durationMs: 60_000, ...over,
});
const log = (over: Record<string, unknown> = {}) => ({
  ID: "log-1", UserId: "user-1", EmployeeId: employee,
  Url: "https://docs.example/page", Screenshot: "https://signed.example/bucket/frame.png?token=secret",
  ScreenCount: 1, ActivityLevel: 30, Status: 1, Productivity: null,
  Title: "Editor", WorkNote: null, ProjectId: null, ClockIn: null, ClockOut: null,
  CreateDate: "2026-11-02T09:00:00Z", ...over,
});
type Deps = Parameters<Awaited<ReturnType<typeof provider>>["fetchPayrollProviderPage"]>[1];
const deps = (post: (path: string, body: unknown) => Promise<unknown>) => {
  let reservations = 0;
  return {
    value: { post: post as never, now: () => new Date("2026-11-02T09:00:00Z"), reserve: async () => { reservations += 1; } } as Deps,
    reservations: () => reservations,
  };
};
const paged = (items: unknown[], page: number, pageSize: number) => {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { Items: items.slice((page - 1) * pageSize, page * pageSize), TotalCount: total, PageCount: pageCount };
};

test("normalization rejects foreign and malformed samples instead of coercing zero", async () => {
  const { normalizePayrollActivity } = await provider();
  const normalize = (raw: unknown, semantic = semantics()) => normalizePayrollActivity(raw, employee, semantic);
  assert.equal(normalize(log({ EmployeeId: "someone-else" })), null);
  assert.equal(normalize(log({ ID: "" })), null);
  assert.equal(normalize(log({ CreateDate: "not-a-date" })), null);
  for (const activity of [null, -1, 61, 3.5, "0", Number.NaN, undefined]) {
    assert.equal(normalize(log({ ActivityLevel: activity }))?.activity, null, String(activity));
    assert.equal(normalize(log({ ActivityLevel: activity }))?.zeroEligible, false, String(activity));
  }
  assert.equal(normalize(log({ ActivityLevel: 0, Status: 2 }))?.zeroEligible, false);
  assert.equal(normalize(log({ ActivityLevel: 0, Status: 4 }))?.zeroEligible, false);
  assert.equal(normalize(log({ ActivityLevel: 0 }))?.zeroEligible, true);
  assert.equal(normalize(log({ ActivityLevel: 30 }))?.zeroEligible, false);
  assert.equal(normalize(log(), semantics({ verified: false }))?.zeroEligible, false);
  const normalized = normalize(log({ Productivity: 7 }))!;
  assert.equal(normalized.activity, 30);
  assert.equal(normalized.productivityCode, 7);
  assert.equal(normalized.app, "Editor");
  assert.equal(normalized.domain, "https://docs.example/page");
  assert.equal(normalized.employeeId, employee);
  assert.equal(normalized.capturedAt, "2026-11-02T09:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(normalized), /token=secret|x_api_key|bucket\/frame/);
});

test("capture spans follow the verified direction and never invent unknown timing", async () => {
  const { normalizePayrollActivity } = await provider();
  const capture = Date.parse("2026-11-02T09:00:00Z");
  const span = (semantic: CaptureSemantics) => normalizePayrollActivity(log(), employee, semantic)?.span;
  assert.deepEqual(span(semantics()), { startMs: capture, endMs: capture + 60_000 });
  assert.deepEqual(span(semantics({ direction: "end" })), { startMs: capture - 60_000, endMs: capture });
  assert.equal(span(semantics({ direction: "unknown" })), null);
  assert.equal(span(semantics({ verified: false })), null);
  assert.equal(span(semantics({ durationMs: 0 })), null);
  assert.equal(span(semantics({ durationMs: 16 * 60_000 })), null);
  assert.deepEqual(span(semantics({ direction: "end", durationMs: 180_000 })), { startMs: capture - 180_000, endMs: capture });
});

test("provider pages repeat the local employee and exact half-open UTC bounds", async () => {
  const { fetchPayrollProviderPage } = await provider();
  const inside = log({ ID: "a", CreateDate: new Date(startMs + 60_000).toISOString() });
  const atStart = log({ ID: "b", CreateDate: new Date(startMs).toISOString() });
  const atEnd = log({ ID: "c", CreateDate: new Date(bounds.endMs).toISOString() });
  const foreign = log({ ID: "d", EmployeeId: "other-emp" });
  const malformed = log({ ID: "e", CreateDate: "yesterday" });
  const fake = deps(async (path, body) => {
    assert.equal(path, "/ActivityLogs/List");
    const request = body as Record<string, unknown>;
    assert.equal(request.EmployeeId, employee);
    assert.equal(request.page, 1);
    assert.equal(request.pageSize, 100);
    assert.equal(request.startDate, new Date(bounds.startMs).toISOString());
    assert.equal(request.endDate, new Date(bounds.endMs).toISOString());
    return paged([inside, atStart, atEnd, foreign, malformed], 1, 100);
  });
  const first = await fetchPayrollProviderPage({ scope: { organizationId: org, personId: person }, employeeId: employee, bounds, cursor: null, connectionId: "conn-1" }, fake.value);
  assert.deepEqual(first.logs.map((item) => item.id).sort(), ["a", "b"]);
  assert.equal(first.complete, true);
  assert.equal(first.nextCursor, null);
  assert.equal(first.watermark, "2026-11-02T00:01:00.000Z");
  assert.equal(fake.reservations(), 1);
});

test("paging is complete for 101 and 800 samples with retry-safe cursors", async () => {
  const { fetchPayrollProviderPage } = await provider();
  const drain = async (count: number) => {
    const items = Array.from({ length: count }, (_, index) => log({
      ID: `log-${index}`, CreateDate: new Date(startMs + index * 60_000).toISOString(),
    }));
    const calls: unknown[] = [];
    const fake = deps(async (_path, body) => {
      const request = body as { page: number };
      calls.push(request.page);
      return paged(items, request.page, 100);
    });
    const logs: { id: string }[] = [];
    let cursor: string | null = null;
    for (let step = 0; step < 20; step += 1) {
      const result = await fetchPayrollProviderPage({ scope: { organizationId: org, personId: person }, employeeId: employee, bounds, cursor, connectionId: "conn-1" }, fake.value);
      logs.push(...result.logs);
      if (result.complete) { assert.equal(result.nextCursor, null); break; }
      assert.equal(result.nextCursor, String(Number(cursor ?? "1") + 1));
      cursor = result.nextCursor;
    }
    return { ids: new Set(logs.map((item) => item.id)).size, calls, reservations: fake.reservations() };
  };
  const two = await drain(101);
  assert.deepEqual(two.calls, [1, 2]);
  assert.equal(two.ids, 101);
  assert.equal(two.reservations, 2);
  const eight = await drain(800);
  assert.deepEqual(eight.calls, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(eight.ids, 800);
  assert.equal(eight.reservations, 8);
  const migrate = await provider().then(({ fetchPayrollProviderPage: fetch }) => fetch({ scope: { organizationId: org, personId: person }, employeeId: employee, bounds, cursor: "2", connectionId: "c" }, (deps(async () => paged([], 2, 100))).value));
  assert.equal(migrate.complete, true);
});

test("a conflicting provider duplicate blocks the page instead of picking a winner", async () => {
  const { fetchPayrollProviderPage } = await provider();
  const fake = (activity: number[]) => deps(async () => ({
    Items: activity.map((value) => log({ ID: "same", ActivityLevel: value })),
    TotalCount: 2, PageCount: 1,
  })).value;
  await assert.rejects(fetchPayrollProviderPage({ scope: { organizationId: org, personId: person }, employeeId: employee, bounds, cursor: null, connectionId: "c" }, fake([0, 30])), /conflict/i);
  // Identical repeats from a provider page overlap are harmless.
  const page = await fetchPayrollProviderPage({ scope: { organizationId: org, personId: person }, employeeId: employee, bounds, cursor: null, connectionId: "c" }, fake([0, 0]));
  assert.equal(page.logs.length, 1);
});

test("a failed provider read never claims completeness", async () => {
  const { fetchPayrollProviderPage } = await provider();
  const fake = deps(async () => { throw new Error("provider down"); });
  await assert.rejects(fetchPayrollProviderPage({ scope: { organizationId: org, personId: person }, employeeId: employee, bounds, cursor: null, connectionId: "c" }, fake.value), /provider down/);
});

test("application context paginates, excludes malformed rows and leaves productivity unrated", async () => {
  const { loadPayrollAppContext, payrollProductivityLabel } = await provider();
  const calls: unknown[] = [];
  const fake = deps(async (path, body) => {
    assert.equal(path, "/Insights/AppsSummary");
    const request = body as { page: number };
    calls.push(request.page);
    return paged([
      { Working: 10, Idle: 5, Productivity: 3, OrganizationApp: { ActivityApp: { Name: "Editor", Url: "editor.example" } } },
      { Working: 4, Idle: 0, Productivity: null, OrganizationApp: { ActivityApp: { Name: null, Url: "docs.example" } } },
      { Working: null, Idle: 5, OrganizationApp: { ActivityApp: { Name: "Broken" } } },
      { Working: 1, Idle: 1, OrganizationApp: null },
    ], request.page, 100);
  });
  const context = await loadPayrollAppContext({ scope: { organizationId: org, personId: person }, employeeId: employee, connectionId: "c", bounds }, fake.value);
  assert.deepEqual(context.items, [
    { name: "Editor", durationMs: 15 * 60_000, productivityCode: 3 },
    { name: "docs.example", durationMs: 4 * 60_000, productivityCode: null },
  ]);
  assert.equal(context.complete, true);
  assert.deepEqual(context.enumLabels, {});
  assert.equal(payrollProductivityLabel(3, context.enumLabels), "unrated");
  assert.ok(context.coverage.some((line) => /omitted/i.test(line)));
  assert.deepEqual(calls, [1]);
  assert.doesNotMatch(JSON.stringify(context), /x_api_key|token=/);
});

test("provider connection resolution requires an active org connection and verified person mapping", async () => {
  const { resolvePayrollProviderConnection } = await provider();
  const f = await payrollFixture();
  try {
    const connection = "90000000-0000-4000-8000-000000000001";
    const otherConnection = "90000000-0000-4000-8000-000000000002";
    await f.db.query("update work_people set worktivity_employee_id=$3 where id=$1 and organization_id=$2", [person, org, employee]);
    await f.db.query("update work_people set worktivity_employee_id='other-emp' where id=$1 and organization_id=$2", [otherPerson, otherOrg]);
    await f.db.query(`insert into work_provider_connections(id,organization_id,provider,external_workspace_id)
      values($1,$2,'worktivity','ws-1'),($3,$4,'worktivity','ws-2')`, [connection, org, otherConnection, otherOrg]);
    await f.db.query(`insert into work_source_accounts(organization_id,provider,external_account_id,person_id,verified)
      values($1,'worktivity',$2,$3,true)`, [org, employee, person]);
    const scope: PayrollScope = { organizationId: org, personId: person };
    await f.db.query(`insert into work_source_accounts(organization_id,provider,external_account_id,person_id,verified)
      values($1,'worktivity',$2,$3,true)`, [org, employee, person]);
    assert.deepEqual(await resolvePayrollProviderConnection(scope), { connectionId: connection, employeeId: employee });
    await assert.rejects(resolvePayrollProviderConnection({ organizationId: otherOrg, personId: person }), /not found/i);
    await f.db.query("update work_provider_connections set active=false where id=$1", [connection]);
    await assert.rejects(resolvePayrollProviderConnection(scope), /connection/i);
    await f.db.query("update work_provider_connections set active=true where id=$1", [connection]);
    await f.db.query("delete from work_source_accounts where organization_id=$1 and person_id=$2", [org, person]);
    await f.db.query(`insert into work_source_accounts(organization_id,provider,external_account_id,person_id,verified)
      values($1,'worktivity',$2,$3,false)`, [org, "wrong-emp", person]);
    await assert.rejects(resolvePayrollProviderConnection(scope), /verified/i);
    await f.db.query(`delete from work_source_accounts where organization_id=$1 and person_id=$2`, [org, person]);
    await f.db.query(`insert into work_source_accounts(organization_id,provider,external_account_id,person_id,verified)
      values($1,'worktivity',$2,$3,true)`, [org, employee, person]);
    assert.deepEqual(await resolvePayrollProviderConnection(scope), { connectionId: connection, employeeId: employee });
  } finally { await f.close(); }
});

test("provider reservations are credential-scoped and serialized through PostgreSQL", async () => {
  const { reservePayrollProviderSlot } = await provider();
  const f = await payrollFixture();
  try {
    const scope: PayrollScope = { organizationId: org, personId: person };
    const connection = "90000000-0000-4000-8000-000000000011";
    const otherConnection = "90000000-0000-4000-8000-000000000012";
    await f.db.query(`insert into work_provider_connections(id,organization_id,provider,external_workspace_id)
      values($1,$2,'worktivity','rate-1'),($3,$4,'worktivity','rate-2')`,[connection,org,otherConnection,otherOrg]);
    const first = await reservePayrollProviderSlot(scope, connection);
    const second = await reservePayrollProviderSlot(scope, connection);
    const third = await reservePayrollProviderSlot(scope, connection);
    assert.equal(first, 0);
    assert.ok(second >= 150 && second <= 400, String(second));
    assert.ok(third >= 300 && third <= 700, String(third));
    assert.equal(await reservePayrollProviderSlot({ organizationId: otherOrg, personId: otherPerson }, otherConnection), 0);
  } finally { await f.close(); }
});
