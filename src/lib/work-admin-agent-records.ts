import {
  WorkOsValidationError,
  type WorkOsAccess,
} from "@/lib/work-os-api";
import { isCalendarDate } from "@/lib/work-os-task-permissions";
import {
  ADMIN_OTTO_MAX_WINDOWS,
  ADMIN_RECORD_COVERAGE,
  adminOttoWindowsFromQuery,
  adminRecordWindows,
  listAdminOttoRecords,
  resolveAdminOttoPeople,
} from "@/lib/work-os-admin-otto-reads";
import type { PersonRef, WorkRecord } from "@/modules/work-os/admin-otto/contracts";

/** Cross-person records for admin tokens: authored updates, submitted EODs,
 * canonical task events, reviewed recaps, and workday snapshots. Every read is
 * scoped by the token's organization through the shared Otto projection, so
 * another organization's record never appears and unsubmitted drafts, private
 * chats, memory, and raw screenshots stay out. */

export const ADMIN_AGENT_RECORD_SOURCES = [
  "update", "submitted_eod", "task", "reviewed_recap", "workday",
] as const;
export const ADMIN_AGENT_RECORD_PERSON_MAX = 20;
export const ADMIN_AGENT_RECORD_QUERY_MAX = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_SET = new Set<string>(ADMIN_AGENT_RECORD_SOURCES);

export type AdminAgentRecordFilters = {
  /** Absent reads the whole organization; an explicit empty list is no rows. */
  personIds: string[] | null;
  sources: WorkRecord["source"][] | null;
  from: string | null;
  to: string | null;
  query: string | null;
  cursor: string | null;
};

export type AdminAgentRecordPage = {
  records: WorkRecord[];
  total: number;
  nextCursor: string | null;
  coverage: string[];
};

function normalizeSources(
  sources: WorkRecord["source"][] | null | undefined,
): WorkRecord["source"][] | null {
  if (sources === null || sources === undefined) return null;
  if (sources.length < 1 || sources.length > ADMIN_AGENT_RECORD_SOURCES.length) {
    throw new WorkOsValidationError("sources must contain between 1 and 5 record sources");
  }
  const unique: WorkRecord["source"][] = [];
  for (const source of sources) {
    if (!SOURCE_SET.has(source)) {
      throw new WorkOsValidationError(
        "sources must be update, submitted_eod, task, reviewed_recap, or workday",
      );
    }
    if (!unique.includes(source)) unique.push(source);
  }
  return unique;
}

/** Service-level validation: the route parses its query string, but the list is
 * also called directly by tests and the MCP layer, so a bad id, date, or source
 * can never reach the projection. */
export function validateAdminAgentRecordFilters(
  filters: AdminAgentRecordFilters,
): AdminAgentRecordFilters {
  let personIds: string[] | null = null;
  if (filters.personIds !== null) {
    if (filters.personIds.length > ADMIN_AGENT_RECORD_PERSON_MAX) {
      throw new WorkOsValidationError("person_ids accepts at most 20 person ids");
    }
    personIds = [...new Set(filters.personIds.map((personId) => personId.toLowerCase()))];
    for (const personId of personIds) {
      if (!UUID_PATTERN.test(personId)) throw new WorkOsValidationError("person_ids must be person UUIDs");
    }
  }
  if (filters.from !== null && !isCalendarDate(filters.from)) {
    throw new WorkOsValidationError("from must be a calendar date");
  }
  if (filters.to !== null && !isCalendarDate(filters.to)) {
    throw new WorkOsValidationError("to must be a calendar date");
  }
  if (filters.from !== null && filters.to !== null && filters.to < filters.from) {
    throw new WorkOsValidationError("to must not be before from");
  }
  const query = filters.query?.trim() || null;
  if (query !== null && query.length > ADMIN_AGENT_RECORD_QUERY_MAX) {
    throw new WorkOsValidationError("q must be 200 characters or fewer");
  }
  return {
    ...filters,
    personIds,
    sources: normalizeSources(filters.sources),
    query,
  };
}

/** Parses the `GET /records` query string. An absent `person_ids` reads the
 * whole organization; an explicitly empty one is no rows. */
export function parseAdminAgentRecordFilters(params: URLSearchParams): AdminAgentRecordFilters {
  let personIds: string[] | null = null;
  const personParam = params.get("person_ids");
  if (personParam !== null) {
    const ids = personParam.split(",").map((value) => value.trim()).filter(Boolean);
    // Bound the raw list before dedupe: a caller repeating one id twenty-one
    // times is still asking for more than the contract allows.
    if (ids.length > ADMIN_AGENT_RECORD_PERSON_MAX) {
      throw new WorkOsValidationError("person_ids accepts at most 20 person ids");
    }
    personIds = ids;
  }

  let sources: WorkRecord["source"][] | null = null;
  const sourceParam = params.get("sources");
  if (sourceParam !== null) {
    const values = sourceParam.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!values.length) throw new WorkOsValidationError("sources must name at least one record source");
    sources = values as WorkRecord["source"][];
  }

  return validateAdminAgentRecordFilters({
    personIds,
    sources,
    from: params.get("from")?.trim() || null,
    to: params.get("to")?.trim() || null,
    query: params.get("q")?.trim() || null,
    cursor: params.get("cursor")?.trim() || null,
  });
}

function emptyRecordPage(): AdminAgentRecordPage {
  // A copy, so a caller cannot mutate the shared coverage line for later pages.
  return { records: [], total: 0, nextCursor: null, coverage: [...ADMIN_RECORD_COVERAGE] };
}

/** One page of the record projection. `person_ids` selects people; the local
 * windows are built per person so a search cannot silently read a different
 * day than the record page shows. */
export async function listAdminAgentRecords(
  access: WorkOsAccess,
  filters: AdminAgentRecordFilters,
): Promise<AdminAgentRecordPage> {
  const validated = validateAdminAgentRecordFilters(filters);
  if (validated.personIds !== null && validated.personIds.length === 0) return emptyRecordPage();

  const resolution = await resolveAdminOttoPeople(access, { kind: "team" });
  if (resolution.kind !== "resolved") return emptyRecordPage();
  const roster = resolution.people;
  const byId = new Map(roster.map((person) => [person.id, person]));
  // person_ids is an organization-wide filter: an id that is not an active
  // member of this organization is ignored rather than turned into an
  // authorization or validation failure, and it can never widen the read.
  const selected: PersonRef[] = validated.personIds === null
    ? roster
    : validated.personIds.flatMap((personId) => {
      const person = byId.get(personId);
      return person ? [person] : [];
    });
  if (!selected.length) return emptyRecordPage();
  if (selected.length > ADMIN_OTTO_MAX_WINDOWS) {
    throw new WorkOsValidationError(
      `person_ids is required when more than ${ADMIN_OTTO_MAX_WINDOWS} people are active`,
    );
  }

  // The Otto window parser owns the calendar-date validation, the 31-day span
  // bound, and the default of the last seven local days per person.
  const windows = await adminOttoWindowsFromQuery(access, new URLSearchParams({
    windows: JSON.stringify(adminRecordWindows(selected, {
      from: validated.from,
      through: validated.to,
    })),
  }));

  const page = await listAdminOttoRecords(access, {
    windows,
    cursor: validated.cursor ?? undefined,
    ...(validated.sources === null ? {} : { sources: validated.sources }),
    query: validated.query,
  });
  return {
    records: page.items,
    total: page.total,
    nextCursor: page.nextCursor,
    coverage: page.coverage,
  };
}
