import { getPool } from "@/lib/db/pool";
import { getGhlStatus } from "@/lib/work-os-ghl-sync";
import { resolveGhlScope } from "@/lib/work-os-ghl-activity";
import type { GhlCoverage, GhlRelation } from "@/lib/work-os-ghl-types";

type Json = Record<string, unknown>;

export interface GhlManagerSummary {
  connected: boolean;
  /** not_connected | disconnected | syncing | ready | partial | degraded */
  state: string;
  performed: number;
  context: Record<Exclude<GhlRelation, "performed">, number>;
  contextTotal: number;
  coverage: GhlCoverage[];
  lastSyncedAt: string | null;
  from: string;
  through: string;
  asOf: string;
}

const EMPTY_CONTEXT = { automation: 0, shared_account: 0, assigned_only: 0, unknown: 0 };

export function ghlManagerState(connected: boolean, coverage: GhlCoverage[]): string {
  if (!connected) return "disconnected";
  if (coverage.some((entry) => entry.state === "unavailable")) return "degraded";
  if (coverage.some((entry) => entry.state === "pending")) return "syncing";
  if (coverage.some((entry) => entry.state === "partial" || entry.capped)) return "partial";
  return coverage.length ? "ready" : "syncing";
}

/** Exact, deduplicated GHL source summary for manager surfaces. Person filters
 * include only verified performed occurrences; organization context is added
 * only when the caller has independently established admin scope. */
export async function getGhlManagerSummary(input: {
  organizationId: string;
  from: string;
  through: string;
  personIds: string[] | null;
  includeOrganizationContext: boolean;
  now?: Date;
}): Promise<GhlManagerSummary> {
  const now = input.now ?? new Date();
  const scope = await resolveGhlScope(input.organizationId);
  if (!scope) {
    return {
      connected: false,
      state: "not_connected",
      performed: 0,
      context: { ...EMPTY_CONTEXT },
      contextTotal: 0,
      coverage: [],
      lastSyncedAt: null,
      from: input.from,
      through: input.through,
      asOf: now.toISOString(),
    };
  }
  const personIds = input.personIds === null ? null : [...new Set(input.personIds.filter(Boolean))];
  if (personIds && !personIds.length) {
    return {
      connected: true,
      state: "ready",
      performed: 0,
      context: { ...EMPTY_CONTEXT },
      contextTotal: 0,
      coverage: [],
      lastSyncedAt: null,
      from: input.from,
      through: input.through,
      asOf: now.toISOString(),
    };
  }
  const result = await getPool().query(
    `select
       count(*) filter (
         where metadata->'ghl'->>'relation' = 'performed'
           and metadata->'ghl'->>'occurredAt' is not null
           and coalesce(metadata->'ghl'->>'snapshot', 'false') <> 'true'
           and person_id is not null
           and ($3::uuid[] is null or person_id = any($3::uuid[]))
       )::int as performed,
       count(*) filter (where metadata->'ghl'->>'relation' = 'automation' and $4::boolean and person_id is null)::int as automation,
       count(*) filter (where metadata->'ghl'->>'relation' = 'shared_account' and $4::boolean and person_id is null)::int as shared_account,
       count(*) filter (where metadata->'ghl'->>'relation' = 'assigned_only' and $4::boolean and person_id is null)::int as assigned_only,
       count(*) filter (where metadata->'ghl'->>'relation' = 'unknown' and $4::boolean and person_id is null)::int as unknown
     from work_evidence_events
     where organization_id = $1 and provider = 'ghl'
       and correction_status <> 'retracted'
       and metadata->'ghl'->>'connectionId' = $2
       and occurred_at >= $5 and occurred_at < $6`,
    [input.organizationId, scope.connectionId, personIds, input.includeOrganizationContext, input.from, input.through],
  );
  const row = (result.rows[0] ?? {}) as Json;
  const status = await getGhlStatus(scope);
  const context = {
    automation: Number(row.automation ?? 0),
    shared_account: Number(row.shared_account ?? 0),
    assigned_only: Number(row.assigned_only ?? 0),
    unknown: Number(row.unknown ?? 0),
  };
  return {
    connected: true,
    state: ghlManagerState(true, status.coverage),
    performed: Number(row.performed ?? 0),
    context,
    contextTotal: Object.values(context).reduce((sum, value) => sum + value, 0),
    coverage: status.coverage,
    lastSyncedAt: status.lastSyncedAt,
    from: input.from,
    through: input.through,
    asOf: now.toISOString(),
  };
}
