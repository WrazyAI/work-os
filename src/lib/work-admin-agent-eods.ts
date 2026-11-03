import { createHash } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import {
  WorkOsConflictError,
  WorkOsForbiddenError,
  WorkOsNotFoundError,
  WorkOsValidationError,
  type WorkOsAccess,
} from "@/lib/work-os-api";
import { reviewWorkOsEod } from "@/lib/work-os-eod";
import { isCalendarDate } from "@/lib/work-os-task-permissions";
import { validCursorTimestamp } from "@/lib/work-agent-tasks";
import { AdminAgentInvalidCursorError } from "@/lib/work-admin-agent-tasks";
import type { Json } from "@/lib/work-os-internal";

/** Cross-person EOD reads and review for admin tokens. Every query is scoped
 * by the token's organization; a token's person mapping never narrows the read.
 * Review reuses `reviewWorkOsEod`, so the self-review prohibition, the
 * `pending_review` gate, and the employee-submission version are exactly the
 * ones the employee and manager surfaces enforce. */

// The admin error mapper recognizes one cursor error name for every collection,
// so the EOD list reuses it instead of defining a second class with the same
// contract.
export { AdminAgentInvalidCursorError };

export const ADMIN_AGENT_EOD_STATUSES = ["pending_review", "approved", "rejected"] as const;
export type AdminAgentEodStatus = (typeof ADMIN_AGENT_EOD_STATUSES)[number];

export type AdminAgentEodPerson = { id: string; displayName: string };

/** List rows carry an excerpt, not the whole report: the detail read is the
 * place that returns the full text and the version history. */
export type AdminAgentEod = {
  id: string;
  person: AdminAgentEodPerson;
  reportDate: string;
  status: AdminAgentEodStatus;
  title: string;
  excerpt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminAgentEodDetail = AdminAgentEod & {
  markdown: string;
  submittedMarkdown: string | null;
  managerNotes: string | null;
  reviewedBy: string | null;
  metrics: Json;
  missingEvidence: Json;
};

export type AdminAgentEodVersion = {
  id: string;
  versionKind: "employee_submission" | "manager_edit";
  markdown: string;
  createdBy: string | null;
  createdAt: string;
};

export type AdminAgentEodFilters = {
  personIds: string[] | null;
  status: AdminAgentEodStatus | null;
  from: string | null;
  to: string | null;
  query: string | null;
  limit: number;
  cursor: string | null;
};

/** Counts describe the person, date, and text filters; the status filter
 * narrows the rows, not the summary, so a reviewer can still see the backlog. */
export type AdminAgentEodCounts = Record<AdminAgentEodStatus, number> & { total: number };

export type AdminAgentEodPage = {
  eods: AdminAgentEod[];
  counts: AdminAgentEodCounts;
  total: number;
  nextCursor: string | null;
};

export type AdminAgentEodCursor = {
  reportDate: string;
  createdAt: string;
  id: string;
  filters: string;
};

export type AdminAgentEodReviewInput = {
  status: "approved" | "rejected";
  manager_notes?: string;
  markdown?: string;
};

export const ADMIN_AGENT_EOD_PAGE_DEFAULT = 50;
export const ADMIN_AGENT_EOD_PAGE_MAX = 100;
export const ADMIN_AGENT_EOD_PERSON_MAX = 20;
const ADMIN_AGENT_EOD_EXCERPT_LENGTH = 400;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_SET = new Set<string>(ADMIN_AGENT_EOD_STATUSES);

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** `%`, `_`, and `\` are LIKE metacharacters; escaping them keeps a search for
 * a literal underscore from acting as a wildcard. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function pageLimit(value: number): number {
  if (!Number.isFinite(value)) throw new WorkOsValidationError("limit must be a number");
  return Math.min(ADMIN_AGENT_EOD_PAGE_MAX, Math.max(1, Math.trunc(value)));
}

/** The filter set a cursor may continue. Limit is excluded: changing a page
 * size does not change which rows match. */
export function adminAgentEodFilterFingerprint(filters: AdminAgentEodFilters): string {
  const normalized = {
    personIds: filters.personIds === null ? null : [...new Set(filters.personIds)].sort(),
    status: filters.status ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    query: filters.query?.trim() || null,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("base64url").slice(0, 22);
}

export function encodeAdminAgentEodCursor(cursor: AdminAgentEodCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeAdminAgentEodCursor(
  value: string | null | undefined,
  filters: AdminAgentEodFilters,
): AdminAgentEodCursor | null {
  if (value == null || value === "") return null;
  let parsed: Record<string, unknown>;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid cursor");
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("invalid cursor");
    parsed = decoded as Record<string, unknown>;
    if (typeof parsed.reportDate !== "string" || !isCalendarDate(parsed.reportDate)) throw new Error("invalid cursor");
    if (typeof parsed.createdAt !== "string" || !validCursorTimestamp(parsed.createdAt)) throw new Error("invalid cursor");
    if (typeof parsed.id !== "string" || !isUuid(parsed.id)) throw new Error("invalid cursor");
    if (typeof parsed.filters !== "string" || !parsed.filters) throw new Error("invalid cursor");
  } catch {
    throw new AdminAgentInvalidCursorError("EOD cursor is invalid");
  }
  if (parsed.filters !== adminAgentEodFilterFingerprint(filters)) {
    throw new AdminAgentInvalidCursorError("EOD cursor does not match these filters");
  }
  return {
    reportDate: parsed.reportDate as string,
    createdAt: parsed.createdAt as string,
    id: parsed.id as string,
    filters: parsed.filters as string,
  };
}

/** Service-level validation: the routes parse their query strings, but the
 * list is also called directly by tests and the MCP layer, so a bad id or date
 * never reaches a Postgres cast. */
export function validateAdminAgentEodFilters(filters: AdminAgentEodFilters): AdminAgentEodFilters {
  if (filters.personIds !== null) {
    if (filters.personIds.length > ADMIN_AGENT_EOD_PERSON_MAX) {
      throw new WorkOsValidationError("person_ids accepts at most 20 person ids");
    }
    for (const personId of filters.personIds) {
      if (!isUuid(personId)) throw new WorkOsValidationError("person_ids must be person UUIDs");
    }
  }
  if (filters.status !== null && !STATUS_SET.has(filters.status)) {
    throw new WorkOsValidationError("status must be pending_review, approved, or rejected");
  }
  if (filters.from !== null && !isCalendarDate(filters.from)) {
    throw new WorkOsValidationError("from must be a calendar date");
  }
  if (filters.to !== null && !isCalendarDate(filters.to)) {
    throw new WorkOsValidationError("to must be a calendar date");
  }
  return filters;
}

/** Parses the `GET /eods` query string. An absent `person_ids` reads the whole
 * organization; an explicitly empty one is no rows, never the whole team. */
export function parseAdminAgentEodFilters(params: URLSearchParams): AdminAgentEodFilters {
  let personIds: string[] | null = null;
  const personParam = params.get("person_ids");
  if (personParam !== null) {
    const ids = personParam.split(",").map((value) => value.trim()).filter(Boolean);
    // Bound the raw list before dedupe: a caller repeating one id twenty-one
    // times is still asking for more than the contract allows.
    if (ids.length > ADMIN_AGENT_EOD_PERSON_MAX) {
      throw new WorkOsValidationError("person_ids accepts at most 20 person ids");
    }
    personIds = [...new Set(ids)];
  }

  const query = params.get("q")?.trim() || null;
  if (query !== null && query.length > 200) {
    throw new WorkOsValidationError("q must be 200 characters or fewer");
  }

  const rawStatus = params.get("status");
  const status = rawStatus === null || rawStatus.trim() === ""
    ? null
    : rawStatus.trim().toLowerCase();
  if (status !== null && !STATUS_SET.has(status)) {
    throw new WorkOsValidationError("status must be pending_review, approved, or rejected");
  }

  const rawLimit = params.get("limit");
  const limit = rawLimit === null || rawLimit.trim() === ""
    ? ADMIN_AGENT_EOD_PAGE_DEFAULT
    : pageLimit(Number(rawLimit));

  return validateAdminAgentEodFilters({
    personIds,
    status: status as AdminAgentEodStatus | null,
    from: params.get("from")?.trim() || null,
    to: params.get("to")?.trim() || null,
    query,
    limit,
    cursor: params.get("cursor")?.trim() || null,
  });
}

type EodRow = Record<string, unknown>;

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toEod(row: EodRow): AdminAgentEod {
  return {
    id: String(row.id),
    person: {
      id: String(row.person_id),
      displayName: String(row.display_name ?? "Unmapped person"),
    },
    reportDate: String(row.report_date),
    status: String(row.status) as AdminAgentEodStatus,
    title: String(row.title ?? ""),
    excerpt: [...String(row.excerpt_source ?? "")].slice(0, ADMIN_AGENT_EOD_EXCERPT_LENGTH).join(""),
    submittedAt: toIso(row.submitted_at),
    reviewedAt: toIso(row.reviewed_at),
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

function toEodDetail(row: EodRow): AdminAgentEodDetail {
  return {
    ...toEod(row),
    markdown: String(row.markdown ?? ""),
    submittedMarkdown: row.submitted_markdown == null ? null : String(row.submitted_markdown),
    managerNotes: row.manager_notes == null ? null : String(row.manager_notes),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    metrics: (row.metrics ?? {}) as Json,
    missingEvidence: (row.missing_evidence ?? []) as Json,
  };
}

function toVersion(row: EodRow): AdminAgentEodVersion {
  return {
    id: String(row.id),
    versionKind: String(row.version_kind) as AdminAgentEodVersion["versionKind"],
    markdown: String(row.markdown ?? ""),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toIso(row.created_at) ?? "",
  };
}

const EOD_FROM = `
  from work_reports r
  left join work_people p
    on p.id = r.person_id and p.organization_id = r.organization_id`;

/** The kind and status predicates keep this surface to submitted EODs: a draft
 * is employee-private until it is submitted, and no future report kind has a
 * review contract here. */
const EOD_FILTERS = `
  r.organization_id = $1
  and r.kind = 'eod'
  and r.status in ('pending_review', 'approved', 'rejected')
  and ($2::uuid[] is null or r.person_id = any($2::uuid[]))
  and ($3::text is null or r.status = $3)
  and ($4::date is null or r.report_date >= $4::date)
  and ($5::date is null or r.report_date <= $5::date)
  and (
    $6::text is null
    or r.title ilike '%' || $6 || '%'
    or coalesce(r.submitted_markdown, '') ilike '%' || $6 || '%'
    or coalesce(r.markdown, '') ilike '%' || $6 || '%'
  )`;

const EOD_SELECT = `
  r.id, r.person_id, r.status, r.title,
  to_char(r.report_date, 'YYYY-MM-DD') as report_date,
  coalesce(r.submitted_markdown, r.markdown, '') as excerpt_source,
  r.submitted_at, r.reviewed_at, r.created_at, r.updated_at,
  p.display_name,
  to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at_cursor`;

function emptyCounts(): AdminAgentEodCounts {
  return { pending_review: 0, approved: 0, rejected: 0, total: 0 };
}

export async function listAdminAgentEods(
  access: WorkOsAccess,
  filters: AdminAgentEodFilters,
): Promise<AdminAgentEodPage> {
  const validated = validateAdminAgentEodFilters(filters);
  const limit = pageLimit(validated.limit);
  // The cursor is validated before the empty-person short-circuit so a stale or
  // malformed cursor never looks like an empty result.
  const cursor = decodeAdminAgentEodCursor(validated.cursor, validated);
  // An explicit empty person list matches nobody. Short-circuiting keeps the
  // answer obviously intentional instead of relying on an empty overlap.
  if (validated.personIds !== null && validated.personIds.length === 0) {
    return { eods: [], counts: emptyCounts(), total: 0, nextCursor: null };
  }

  const search = validated.query ? escapeLike(validated.query.trim()) : null;
  // Counts deliberately pass a null status: the summary describes the filtered
  // backlog, not only the rows the status filter selected.
  const filtersForCounts = [
    access.organizationId,
    validated.personIds,
    null,
    validated.from,
    validated.to,
    search,
  ];
  const parameters = [
    access.organizationId,
    validated.personIds,
    validated.status,
    validated.from,
    validated.to,
    search,
  ];
  const pool = getPool();

  const [count, statusCounts] = await Promise.all([
    pool.query<{ total: number | string }>(
      `select count(*)::int as total from work_reports r where ${EOD_FILTERS}`,
      parameters,
    ),
    pool.query<{ status: string; total: number | string }>(
      `select r.status, count(*)::int as total ${EOD_FROM}
       where ${EOD_FILTERS}
       group by r.status`,
      filtersForCounts,
    ),
  ]);

  const counts = emptyCounts();
  for (const row of statusCounts.rows) {
    const status = String(row.status) as AdminAgentEodStatus;
    if (status in counts) counts[status] = Number(row.total);
    counts.total += Number(row.total);
  }

  const rows = await pool.query<EodRow>(
    `select ${EOD_SELECT} ${EOD_FROM}
     where ${EOD_FILTERS}
       and (
         $7::date is null
         or (r.report_date, r.created_at, r.id) < ($7::date, $8::timestamptz, $9::uuid)
       )
     order by r.report_date desc, r.created_at desc, r.id desc
     limit $10`,
    [
      ...parameters,
      cursor?.reportDate ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );

  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.rows.length > limit && last
    ? encodeAdminAgentEodCursor({
      reportDate: String(last.report_date),
      createdAt: String(last.created_at_cursor),
      id: String(last.id),
      filters: adminAgentEodFilterFingerprint(validated),
    })
    : null;

  return {
    eods: page.map(toEod),
    counts,
    total: Number(count.rows[0]?.total ?? 0),
    nextCursor,
  };
}

export async function getAdminAgentEod(
  access: WorkOsAccess,
  reportId: string,
): Promise<{ eod: AdminAgentEodDetail; versions: AdminAgentEodVersion[] } | null> {
  // A malformed id cannot match a row; answering null keeps the route's 404
  // contract instead of surfacing a Postgres uuid cast error.
  if (!isUuid(reportId)) return null;
  const pool = getPool();
  const report = await pool.query<EodRow>(
    `select r.id, r.person_id, r.status, r.title, r.markdown, r.submitted_markdown,
       r.manager_notes, r.reviewed_by, r.metrics, r.missing_evidence,
       r.submitted_at, r.reviewed_at, r.created_at, r.updated_at,
       to_char(r.report_date, 'YYYY-MM-DD') as report_date,
       coalesce(r.submitted_markdown, r.markdown, '') as excerpt_source,
       p.display_name
     from work_reports r
     left join work_people p
       on p.id = r.person_id and p.organization_id = r.organization_id
     where r.organization_id = $1 and r.id = $2 and r.kind = 'eod'
       and r.status in ('pending_review', 'approved', 'rejected')`,
    [access.organizationId, reportId],
  );
  const row = report.rows[0];
  if (!row) return null;

  const versions = await pool.query<EodRow>(
    // Draft versions are the employee's pre-submission scratch text: they were
    // never shown to a manager, so the admin detail returns only the submitted
    // and manager-edited history.
    `select id, version_kind, markdown, created_by, created_at
     from work_report_versions
     where organization_id = $1 and report_id = $2
       and version_kind in ('employee_submission', 'manager_edit')
     order by created_at asc, id asc`,
    [access.organizationId, reportId],
  );

  return { eod: toEodDetail(row), versions: versions.rows.map(toVersion) };
}

/** Review translation: `reviewWorkOsEod` speaks in plain errors, so the admin
 * API maps the decision states before delegating to it. The reviewer's person
 * is resolved from the membership by the auth layer and passed in, because an
 * admin token is valid with `person_id = null`; without it the self-review
 * prohibition would only fire for mapped tokens. */
export async function reviewAdminAgentEod(
  access: WorkOsAccess,
  reportId: string,
  body: AdminAgentEodReviewInput,
  reviewerPersonId?: string | null,
): Promise<Json> {
  if (!isUuid(reportId)) throw new WorkOsNotFoundError("EOD report not found");
  if (body?.status !== "approved" && body?.status !== "rejected") {
    throw new WorkOsValidationError("status must be approved or rejected");
  }
  for (const field of ["manager_notes", "markdown"] as const) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      throw new WorkOsValidationError(`${field} must be a string`);
    }
  }

  const found = await getPool().query<{ person_id: string | null; status: string }>(
    `select person_id, status from work_reports
     where organization_id = $1 and id = $2 and kind = 'eod'`,
    [access.organizationId, reportId],
  );
  const report = found.rows[0];
  if (!report) throw new WorkOsNotFoundError("EOD report not found");
  // Review integrity: a manager who is also an employee must never decide their
  // own report. The token's own mapping is the fallback; the resolved reviewer
  // person (token or membership) is authoritative when supplied.
  const effectivePersonId = reviewerPersonId ?? access.personId;
  if (report.person_id !== null && report.person_id === effectivePersonId) {
    throw new WorkOsForbiddenError("You cannot review your own EOD report. Ask another manager to review it.");
  }
  if (report.status !== "pending_review") {
    throw new WorkOsConflictError("report is no longer pending review", "report_not_pending");
  }

  // The shared service repeats the self-review check against `access.personId`,
  // so hand it the same person this wrapper checked.
  const reviewerAccess: WorkOsAccess = effectivePersonId === access.personId
    ? access
    : {
      ...access,
      personId: effectivePersonId,
      workspaces: access.workspaces.map((workspace) =>
        workspace.organizationId === access.organizationId
          ? { ...workspace, personId: effectivePersonId }
          : workspace),
    };

  try {
    return await reviewWorkOsEod(reviewerAccess, reportId, body as unknown as Json);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    // A concurrent decision is a 409 on both sides of the race: the shared
    // service's own pre-check, and the conditional update in `reviewReport`
    // that loses after the pre-check passed.
    if (
      message === "only pending reports can be reviewed"
      || message === "report is no longer pending review"
    ) {
      throw new WorkOsConflictError("report is no longer pending review", "report_not_pending");
    }
    if (/cannot review your own/i.test(message)) throw new WorkOsForbiddenError(message);
    throw error;
  }
}
