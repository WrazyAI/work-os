import { getPool } from "@/lib/db/pool";
import { WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import type {
  AdminAgentPerson,
  AdminAgentPersonDetail,
  AdminAgentProject,
} from "@/modules/work-os/admin-agent/contracts";

/** Organization-wide directory reads for admin tokens. Every query is scoped
 * by the token's organization, never by the token's person: an admin token may
 * have no person, and a person-mapped admin token still reads the directory. */

export type { AdminAgentPerson, AdminAgentPersonDetail, AdminAgentProject };

export type AdminAgentPeopleFilters = {
  query: string | null;
  active: boolean | null;
  teamId: string | null;
  role: string | null;
  limit: number;
  cursor: string | null;
};

export type AdminAgentPeoplePage = {
  people: AdminAgentPerson[];
  total: number;
  nextCursor: string | null;
};

export type AdminAgentPeopleCursor = { name: string; id: string };

export const ADMIN_AGENT_PEOPLE_PAGE_DEFAULT = 50;
export const ADMIN_AGENT_PEOPLE_PAGE_MAX = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** `%`, `_`, and `\` are LIKE metacharacters; escaping them keeps a directory
 * search for a literal underscore from acting as a wildcard. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function encodeAdminAgentPeopleCursor(cursor: AdminAgentPeopleCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeAdminAgentPeopleCursor(value: string | null | undefined): AdminAgentPeopleCursor | null {
  if (value == null || value === "") return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid cursor");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    if (typeof parsed.name !== "string" || !parsed.name) throw new Error("invalid cursor");
    if (typeof parsed.id !== "string" || !isUuid(parsed.id)) throw new Error("invalid cursor");
    return { name: parsed.name, id: parsed.id };
  } catch {
    throw new WorkOsValidationError("People cursor is invalid");
  }
}

function pageLimit(value: number): number {
  if (!Number.isFinite(value)) throw new WorkOsValidationError("limit must be a number");
  return Math.min(ADMIN_AGENT_PEOPLE_PAGE_MAX, Math.max(1, Math.trunc(value)));
}

/** Parses the `GET /people` query string. Active is the default because the
 * directory answers "who works here now"; `active=all` lifts the filter. */
export function parseAdminAgentPeopleFilters(params: URLSearchParams): AdminAgentPeopleFilters {
  const query = params.get("q")?.trim() || null;

  const rawActive = params.get("active");
  let active: boolean | null;
  if (rawActive === null || rawActive.trim() === "") {
    active = true;
  } else {
    const normalized = rawActive.trim().toLowerCase();
    if (normalized === "true") active = true;
    else if (normalized === "false") active = false;
    else if (normalized === "all") active = null;
    else throw new WorkOsValidationError("active must be true, false, or all");
  }

  const teamId = params.get("team_id")?.trim() || null;
  if (teamId && !isUuid(teamId)) throw new WorkOsValidationError("team_id must be a UUID");

  const role = params.get("role")?.trim() || null;

  const rawLimit = params.get("limit");
  const limit = rawLimit === null || rawLimit.trim() === ""
    ? ADMIN_AGENT_PEOPLE_PAGE_DEFAULT
    : pageLimit(Number(rawLimit));

  return {
    query,
    active,
    teamId,
    role,
    limit,
    cursor: params.get("cursor")?.trim() || null,
  };
}

type PersonRow = {
  id: string;
  display_name: string;
  email: string | null;
  active: boolean;
  timezone: string | null;
  role_profile_id: string | null;
  role_profile_name: string | null;
  sort_name: string;
};

type DetailRow = Omit<PersonRow, "sort_name">;

type TeamRow = { id: string; name: string; active: boolean; is_manager: boolean };
type ManagerRow = { id: string; display_name: string };

function toPerson(row: PersonRow | DetailRow): AdminAgentPerson {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    email: (row.email as string | null) ?? null,
    active: row.active === true,
    timezone: (row.timezone as string | null) ?? null,
    roleProfile: row.role_profile_id
      ? { id: String(row.role_profile_id), name: String(row.role_profile_name ?? "") }
      : null,
  };
}

const PERSON_SELECT = `
  p.id, p.display_name, p.email, p.active,
  lower(p.display_name) as sort_name,
  rp.id as role_profile_id, rp.name as role_profile_name,
  o.timezone`;

const PERSON_FROM = `
  from work_people p
  left join work_role_profiles rp
    on rp.id = p.role_profile_id and rp.organization_id = p.organization_id
  left join work_employee_onboarding o
    on o.organization_id = p.organization_id and o.person_id = p.id`;

const PEOPLE_FILTERS = `
  p.organization_id = $1
  and ($2::boolean is null or p.active = $2)
  and ($3::text is null
    or lower(p.display_name) like '%' || lower($3) || '%'
    or lower(coalesce(p.email, '')) like '%' || lower($3) || '%')
  and ($4::uuid is null or exists (
    select 1
    from work_team_members tm
    join work_teams t on t.id = tm.team_id and t.organization_id = $1
    where tm.team_id = $4 and tm.person_id = p.id
  ))
  and ($5::text is null or rp.name = $5)`;

export async function listAdminAgentPeople(
  access: WorkOsAccess,
  filters: AdminAgentPeopleFilters,
): Promise<AdminAgentPeoplePage> {
  if (filters.teamId && !isUuid(filters.teamId)) throw new WorkOsValidationError("team_id must be a UUID");
  const pool = getPool();
  const limit = pageLimit(filters.limit);
  const cursor = decodeAdminAgentPeopleCursor(filters.cursor);
  // The SQL adds the wildcards; the escaped term is passed as-is so a literal
  // `%` or `_` stays literal.
  const search = filters.query ? escapeLike(filters.query.trim()) : null;
  const parameters = [access.organizationId, filters.active, search, filters.teamId, filters.role];

  const count = await pool.query<{ total: number | string }>(
    `select count(*)::int as total ${PERSON_FROM} where ${PEOPLE_FILTERS}`,
    parameters,
  );
  const rows = await pool.query<PersonRow>(
    `select ${PERSON_SELECT} ${PERSON_FROM}
     where ${PEOPLE_FILTERS}
       and ($6::text is null or (lower(p.display_name), p.id) > ($6::text, $7::uuid))
     order by lower(p.display_name), p.id
     limit $8`,
    [...parameters, cursor?.name ?? null, cursor?.id ?? null, limit + 1],
  );

  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.rows.length > limit && last
    ? encodeAdminAgentPeopleCursor({ name: last.sort_name, id: String(last.id) })
    : null;

  return {
    people: page.map(toPerson),
    total: Number(count.rows[0]?.total ?? 0),
    nextCursor,
  };
}

export async function getAdminAgentPerson(
  access: WorkOsAccess,
  personId: string,
): Promise<AdminAgentPersonDetail | null> {
  // A malformed id cannot match a row; answering null keeps the route's 404
  // contract instead of surfacing a Postgres uuid cast error.
  if (!isUuid(personId)) return null;
  const pool = getPool();
  const person = await pool.query<DetailRow>(
    `select ${PERSON_SELECT} ${PERSON_FROM}
     where p.organization_id = $1 and p.id = $2`,
    [access.organizationId, personId],
  );
  const row = person.rows[0];
  if (!row) return null;

  const [teams, manager] = await Promise.all([
    pool.query<TeamRow>(
      `select t.id, t.name, t.active, tm.is_manager
       from work_team_members tm
       join work_teams t on t.id = tm.team_id
       where tm.person_id = $2 and t.organization_id = $1
       order by lower(t.name), t.id`,
      [access.organizationId, personId],
    ),
    // A manager is a flagged member of any team this person belongs to,
    // excluding the person themself. The organization filter keeps a stray
    // cross-tenant team link from leaking a name.
    pool.query<ManagerRow>(
      `select p.id, p.display_name
       from work_team_members mine
       join work_team_members leads
         on leads.team_id = mine.team_id and leads.is_manager = true and leads.person_id <> mine.person_id
       join work_teams t on t.id = mine.team_id and t.organization_id = $1
       join work_people p on p.id = leads.person_id and p.organization_id = $1
       where mine.person_id = $2
       group by p.id, p.display_name
       order by lower(p.display_name), p.id
       limit 1`,
      [access.organizationId, personId],
    ),
  ]);

  const base = toPerson(row);
  return {
    ...base,
    schedule: base.timezone ? { timezone: base.timezone } : null,
    manager: manager.rows[0]
      ? { id: String(manager.rows[0].id), displayName: String(manager.rows[0].display_name) }
      : null,
    teams: teams.rows.map((team) => ({
      id: String(team.id),
      name: String(team.name),
      isManager: team.is_manager === true,
      active: team.active === true,
    })),
  };
}

export async function listAdminAgentProjects(access: WorkOsAccess): Promise<AdminAgentProject[]> {
  const result = await getPool().query<{
    id: string; name: string; provider: string; provider_project_id: string; archived: boolean;
  }>(
    `select id, name, provider, provider_project_id, coalesce(archived, false) as archived
     from work_projects
     where organization_id = $1 and coalesce(archived, false) = false
     order by lower(name), id`,
    [access.organizationId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    provider: String(row.provider),
    providerProjectId: String(row.provider_project_id),
    archived: row.archived === true,
  }));
}
