import { getPool } from "@/lib/db/pool";
import { wtPost } from "@/lib/worktivity";
import type {
  CaptureSemantics, NormalizedActivity, PayrollAppContext, PayrollScope, Span,
} from "@/modules/work-os/payroll/contracts";

const PROVIDER = "worktivity";
export const PAYROLL_PROVIDER_BASE = "https://open-api.useworktivity.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const MAX_CAPTURE_MS = 15 * 60_000;

export type PayrollProviderDeps = {
  post: typeof wtPost;
  now: () => Date;
  reserve: (connectionId: string) => Promise<void>;
};

type RawRecord = Record<string, unknown>;
type WtPage<T> = { Items?: T[]; TotalCount?: number; PageCount?: number };

const text = (value: unknown): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
};
const finite = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
const integer = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
const instant = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const iso = (ms: number) => new Date(ms).toISOString();

/** A capture sample is one observation, never a duration. `zeroEligible` only
 * becomes true when the adapter's capture direction/duration was verified live;
 * unknown timing stays display-only so it can never trigger a deduction. */
export function normalizePayrollActivity(raw: unknown, employeeId: string, semantics: CaptureSemantics): NormalizedActivity | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as RawRecord;
  const id = text(row.ID);
  if (!id || text(row.EmployeeId) !== employeeId) return null;
  const captureMs = instant(row.CreateDate);
  if (captureMs === null) return null;
  const activity = integer(row.ActivityLevel, 0, 60);
  const status = integer(row.Status, 0, 5);
  const duration = finite(semantics.durationMs, 1, MAX_CAPTURE_MS);
  const timed = semantics.verified && duration !== null && semantics.direction !== "unknown";
  const span: Span | null = timed
    ? semantics.direction === "start"
      ? { startMs: captureMs, endMs: captureMs + duration! }
      : { startMs: captureMs - duration!, endMs: captureMs }
    : null;
  return {
    id, employeeId, capturedAt: iso(captureMs), span, activity,
    zeroEligible: timed && activity === 0 && (status === 1 || status === 3),
    status,
    app: text(row.Title), title: text(row.Title), domain: text(row.Url),
    productivityCode: finite(row.Productivity, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  };
}

function parseCursor(cursor: string | null): number {
  if (cursor === null) return 1;
  if (!/^[1-9]\d*$/.test(cursor)) throw new Error("Provider page cursor is invalid");
  const page = Number(cursor);
  if (page > MAX_PAGES) throw new Error("Provider page cursor exceeds the bounded page limit");
  return page;
}

function sameActivity(left: NormalizedActivity, right: NormalizedActivity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function fetchPayrollProviderPage(
  input: { scope: PayrollScope; employeeId: string; bounds: Span; cursor: string | null; connectionId: string; semantics?: CaptureSemantics },
  deps: PayrollProviderDeps,
): Promise<{ logs: NormalizedActivity[]; nextCursor: string | null; complete: boolean; watermark: string }> {
  if (!input.employeeId.trim()) throw new Error("A verified provider employee mapping is required");
  if (!Number.isFinite(input.bounds.startMs) || !Number.isFinite(input.bounds.endMs) || input.bounds.endMs <= input.bounds.startMs) {
    throw new Error("Provider bounds must be a finite half-open span");
  }
  const page = parseCursor(input.cursor);
  await deps.reserve(input.connectionId);
  const data = await deps.post<WtPage<RawRecord>>("/ActivityLogs/List", {
    EmployeeId: input.employeeId,
    startDate: iso(input.bounds.startMs),
    endDate: iso(input.bounds.endMs),
    page,
    pageSize: PAGE_SIZE,
  });
  if (!Array.isArray(data?.Items)) throw new Error("Provider activity page is malformed");
  const seen = new Map<string, NormalizedActivity>();
  let watermarkMs = -Infinity;
  for (const raw of data.Items) {
    const normalized = normalizePayrollActivity(raw, input.employeeId, input.semantics ?? unverifiedSemantics);
    if (!normalized) continue;
    const captureMs = Date.parse(normalized.capturedAt);
    if (captureMs < input.bounds.startMs || captureMs >= input.bounds.endMs) continue;
    if (captureMs > watermarkMs) watermarkMs = captureMs;
    const existing = seen.get(normalized.id);
    if (existing) {
      if (!sameActivity(existing, normalized)) throw new Error(`Provider activity conflict for log ${normalized.id}`);
      continue;
    }
    seen.set(normalized.id, normalized);
  }
  const pageCount = typeof data.PageCount === "number" && Number.isFinite(data.PageCount) ? Math.trunc(data.PageCount) : 1;
  if (pageCount < 1) throw new Error("Provider page count is invalid");
  const total = typeof data.TotalCount === "number" && Number.isFinite(data.TotalCount) ? data.TotalCount : 0;
  if (total > page * PAGE_SIZE && pageCount <= page) throw new Error("Provider pagination is inconsistent; coverage is incomplete");
  if (page < pageCount && page >= MAX_PAGES) throw new Error("Provider pagination exceeded the bounded page limit; coverage is incomplete");
  // The provider ignores EmployeeId/date filters at page boundaries; the local
  // filter + canonical replay of the full cursor range is the contract.
  const complete = page >= pageCount;
  return {
    logs: [...seen.values()].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id)),
    nextCursor: complete ? null : String(page + 1),
    complete,
    watermark: Number.isFinite(watermarkMs) ? iso(watermarkMs) : "",
  };
}

/** Payroll does not inherit a duration/direction claim from neighboring code.
 * The only time this changes is a documented live capture probe (Task 19). */
export const unverifiedSemantics: CaptureSemantics = {
  version: "worktivity-activitylog-v1", verified: false, direction: "unknown", durationMs: 60_000,
};

const VERIFIED_PRODUCTIVITY_LABELS: Record<string, string> = {};

export function payrollProductivityLabel(code: number | null, labels = VERIFIED_PRODUCTIVITY_LABELS): string {
  return code === null ? "unrated" : labels[String(code)] ?? "unrated";
}

export async function resolvePayrollProviderConnection(scope: PayrollScope): Promise<{ connectionId: string; employeeId: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(scope.organizationId) || !/^[0-9a-f-]{36}$/i.test(scope.personId)) {
    throw new Error("Payroll scope identifiers are invalid");
  }
  const pool = getPool();
  const person = await pool.query<{ worktivity_employee_id: string | null }>(
    "select worktivity_employee_id from work_people where organization_id=$1 and id=$2",
    [scope.organizationId, scope.personId],
  );
  if (!person.rows.length) throw new Error("Payroll person not found");
  const connection = await pool.query<{ id: string }>(
    "select id from work_provider_connections where organization_id=$1 and provider=$2 and active order by id limit 2",
    [scope.organizationId, PROVIDER],
  );
  if (connection.rows.length !== 1) throw new Error(connection.rows.length ? "Multiple active Worktivity connections are ambiguous" : "No active Worktivity connection is configured");
  const accounts = await pool.query<{ external_account_id: string; verified: boolean }>(
    "select external_account_id, verified from work_source_accounts where organization_id=$1 and provider=$2 and person_id=$3 order by verified desc, external_account_id",
    [scope.organizationId, PROVIDER, scope.personId],
  );
  const mapped = person.rows[0].worktivity_employee_id?.trim() || null;
  const employeeId = accounts.rows.length
    ? accounts.rows.find((account) => account.verified && account.external_account_id === mapped)?.external_account_id ?? null
    : mapped;
  if (!employeeId) throw new Error("The person has no verified Worktivity employee mapping");
  if (accounts.rows.length && !accounts.rows.some((account) => account.verified)) {
    throw new Error("The Worktivity source account is not verified");
  }
  return { connectionId: connection.rows[0].id, employeeId };
}

/** Reserves one provider request against the shared credential budget. The SQL
 * row lock serializes processes; this function sleeps only after committing the
 * slot so no transaction is held across network latency. */
export async function reservePayrollProviderSlot(scope: PayrollScope, connectionId: string): Promise<number> {
  const result = await getPool().query<{ wait_ms: number }>(
    "select work_payroll_reserve_provider_slot($1,$2) as wait_ms",
    [scope.organizationId, connectionId],
  );
  return Number(result.rows[0]?.wait_ms ?? 0);
}

export function payrollProviderDeps(scope: PayrollScope): PayrollProviderDeps {
  return {
    post: wtPost,
    now: () => new Date(),
    reserve: async (connectionId) => {
      const waitMs = await reservePayrollProviderSlot(scope, connectionId);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    },
  };
}

export async function loadPayrollAppContext(
  input: { scope: PayrollScope; employeeId: string; connectionId: string; bounds: Span },
  deps: PayrollProviderDeps,
): Promise<PayrollAppContext> {
  const items: PayrollAppContext["items"] = [];
  const coverage: string[] = ["Provider-reported window; application usage is context, never payable time."];
  let omitted = 0;
  let page = 1;
  for (; page <= MAX_PAGES; page += 1) {
    await deps.reserve(input.connectionId);
    const data = await deps.post<WtPage<RawRecord>>("/Insights/AppsSummary", {
      EmployeeId: input.employeeId,
      startDate: iso(input.bounds.startMs),
      endDate: iso(input.bounds.endMs),
      page,
      pageSize: PAGE_SIZE,
    });
    if (!Array.isArray(data?.Items)) throw new Error("Provider application summary is malformed");
    for (const raw of data.Items) {
      if (!raw || typeof raw !== "object") { omitted += 1; continue; }
      const row = raw as RawRecord;
      const app = (row.OrganizationApp as RawRecord | null | undefined)?.ActivityApp as RawRecord | null | undefined;
      const name = text(app?.Name) ?? text(app?.Url);
      const working = finite(row.Working, 0, 24 * 60);
      const idle = finite(row.Idle, 0, 24 * 60);
      if (!name || working === null || idle === null) { omitted += 1; continue; }
      items.push({
        name,
        durationMs: Math.round((working + idle) * 60_000),
        productivityCode: finite(row.Productivity, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      });
    }
    const pageCount = typeof data.PageCount === "number" && Number.isFinite(data.PageCount) ? Math.trunc(data.PageCount) : 1;
    if (page >= pageCount) break;
  }
  if (page > MAX_PAGES) throw new Error("Provider application summary exceeded the bounded page limit");
  if (omitted) coverage.push(`${omitted} provider application rows omitted because their names or tracked totals were not valid numbers.`);
  coverage.push("Productivity codes have no verified label mapping; they are shown as unrated.");
  return { items, complete: true, coverage, enumLabels: {} };
}
