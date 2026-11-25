/* Server-side EOD preparation.
 *
 * The employee never has to press "Draft" for the analysis to exist. A bounded
 * scheduler run finds recently worked or planned days, applies the same shift
 * gate the employee surface uses, and prepares the structured suggestions and
 * evidence snapshot before the employee opens the composer.
 *
 * The run is idempotent per day and preserves anything the employee has
 * already written. It never submits a report.
 */

import { addDaysIso } from "@/lib/work-os-dates";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";
import type { Json } from "@/lib/work-os-internal";
import { eodDraftShiftGate } from "@/lib/work-os-eod-shift-gate";
import { prepareWorkOsEod } from "@/lib/work-os-eod";

export const SCHEDULED_EOD_MAX = 48;
export const SCHEDULED_EOD_RETRY_MS = 10 * 60_000;

type Candidate = { organizationId: string; personId: string; date: string };

type EodRunReason =
  | "missing_actor"
  | "inactive"
  | "leave"
  | "shift_open"
  | "already_submitted"
  | "recently_prepared"
  | "employee_editing"
  | "candidate_lookup_failed"
  | "prepare_failed";

export interface ScheduledEodRunResult {
  attempted: number;
  employees: number;
  prepared: number;
  skipped: number;
  failed: number;
  reasons: Partial<Record<EodRunReason, number>>;
}

let scheduledRun: Promise<ScheduledEodRunResult> | null = null;
let candidateOffset = 0;

function addReason(result: ScheduledEodRunResult, reason: EodRunReason) {
  result.reasons[reason] = (result.reasons[reason] ?? 0) + 1;
}

/** Bounded cron work. The caller supplies the limit so one deployment tick can
 * never walk the whole organization. */
export async function runScheduledEodPreparation(
  limit = 24,
  at = new Date(),
  mode: "due" | "fallback" = "fallback",
): Promise<ScheduledEodRunResult> {
  if (!process.env.CRON_SECRET) {
    throw new Error("scheduled EOD preparation is not ready: CRON_SECRET is required");
  }
  if (scheduledRun) return scheduledRun;
  const run = (async (): Promise<ScheduledEodRunResult> => {
    const db = createAdminClient();
    const bounded = Math.min(SCHEDULED_EOD_MAX, Math.max(1, Math.floor(limit)));
    // Three days of sessions/plans for a large pilot fits in this bounded
    // scan; the rotation below keeps later candidates reachable when the
    // prefix is ineligible.
    const pageSize = Math.max(600, bounded * 12);
    const through = addDaysIso(at.toISOString().slice(0, 10), 1);
    const from = addDaysIso(through, -3);
    // The due dispatcher runs every minute. It targets each employee's own
    // scheduled clock-out rather than a global five-minute sweep: the normal
    // window is ten minutes before the end, with a two-minute safety margin
    // for timer drift, and a 30-minute missed-tick window after it.
    const dueFrom = new Date(at.getTime() + 8 * 60_000).toISOString();
    const dueTo = new Date(at.getTime() + 12 * 60_000).toISOString();
    const missedFrom = new Date(at.getTime() - 30 * 60_000).toISOString();
    const result: ScheduledEodRunResult = {
      attempted: 0,
      employees: 0,
      prepared: 0,
      skipped: 0,
      failed: 0,
      reasons: {},
    };

    const sessionsQuery = mode === "due"
      ? db.from("work_sessions")
        .select("organization_id,person_id,shift_date")
        .not("person_id", "is", null)
        .not("scheduled_ends_at", "is", null)
        .or(`and(scheduled_ends_at.gte.${dueFrom},scheduled_ends_at.lte.${dueTo}),and(scheduled_ends_at.gte.${missedFrom},scheduled_ends_at.lt.${at.toISOString()})`)
        .order("scheduled_ends_at", { ascending: true })
        .limit(240)
      : db.from("work_sessions")
        .select("organization_id,person_id,shift_date")
        .not("person_id", "is", null)
        .gte("shift_date", from)
        .lte("shift_date", through)
        .order("shift_date", { ascending: false })
        .limit(pageSize);
    const plansQuery = mode === "fallback"
      ? db.from("work_daily_plans")
        .select("organization_id,person_id,shift_date")
        .not("person_id", "is", null)
        .gte("shift_date", from)
        .lte("shift_date", through)
        .order("shift_date", { ascending: false })
        .limit(pageSize)
      : Promise.resolve({ data: [], error: null });
    const [sessionsResult, plansResult] = await Promise.all([sessionsQuery, plansQuery]);
    if (sessionsResult.error) throw new Error(`load scheduled EOD sessions: ${sessionsResult.error.message}`);
    if (plansResult.error) throw new Error(`load scheduled EOD plans: ${plansResult.error.message}`);

    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const row of [...(sessionsResult.data ?? []), ...(plansResult.data ?? [])] as Json[]) {
      const organizationId = String(row.organization_id ?? "");
      const personId = String(row.person_id ?? "");
      const date = String(row.shift_date ?? "").slice(0, 10);
      if (!organizationId || !personId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const key = `${organizationId}:${personId}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ organizationId, personId, date });
    }
    if (!candidates.length) return result;

    // Rotate the start so a permanently blocked prefix cannot starve the rest
    // of the organization on every five-minute tick.
    const ordered = candidates.map((_, index) => candidates[(candidateOffset + index) % candidates.length]);
    const organizations = new Map<string, { organizationId: string; actorId: string | null; featureFlags: Record<string, boolean> }>();
    const people = new Map<string, { active: boolean }>();
    let consumed = 0;

    for (const candidate of ordered) {
      if (result.attempted >= bounded) break;
      consumed += 1;
      try {
        let organization = organizations.get(candidate.organizationId);
        if (!organization) {
          const loaded = await db.from("work_organizations")
            .select("feature_flags,legacy_owner_id,created_by")
            .eq("id", candidate.organizationId)
            .maybeSingle();
          if (loaded.error) throw new Error("candidate lookup failed");
          const flags = (loaded.data?.feature_flags ?? {}) as Json;
          organization = {
            organizationId: candidate.organizationId,
            actorId: (loaded.data?.legacy_owner_id || loaded.data?.created_by || null) as string | null,
            featureFlags: flags as Record<string, boolean>,
          };
          organizations.set(candidate.organizationId, organization);
        }
        if (!organization.actorId) {
          result.skipped += 1;
          addReason(result, "missing_actor");
          continue;
        }

        const personKey = `${candidate.organizationId}:${candidate.personId}`;
        let person = people.get(personKey);
        if (!person) {
          const loaded = await db.from("work_people")
            .select("active")
            .eq("organization_id", candidate.organizationId)
            .eq("id", candidate.personId)
            .maybeSingle();
          if (loaded.error) throw new Error("candidate lookup failed");
          person = { active: loaded.data?.active !== false };
          people.set(personKey, person);
        }
        if (!person.active) {
          result.skipped += 1;
          addReason(result, "inactive");
          continue;
        }

        const exception = await db.from("work_schedule_exceptions")
          .select("kind")
          .eq("organization_id", candidate.organizationId)
          .eq("person_id", candidate.personId)
          .eq("exception_date", candidate.date)
          .maybeSingle();
        if (exception.error) throw new Error("candidate lookup failed");
        if (String(exception.data?.kind ?? "") === "leave") {
          result.skipped += 1;
          addReason(result, "leave");
          continue;
        }

        const access = {
          ctx: { user: { id: organization.actorId }, profile: { id: organization.actorId } },
          organizationId: candidate.organizationId,
          organizationName: "",
          organizationOwnerId: organization.actorId,
          role: "admin",
          personId: candidate.personId,
          membershipId: `system-eod-schedule:${candidate.personId}`,
          featureFlags: organization.featureFlags,
          workspaces: [],
        } as unknown as WorkOsAccess;

        const gate = await eodDraftShiftGate(access, candidate.personId, candidate.date);
        if (gate.blocked) {
          result.skipped += 1;
          addReason(result, "shift_open");
          continue;
        }

        const existing = await db.from("work_reports")
          .select("id,status,submitted_at,prepared_at,structured_report")
          .eq("organization_id", candidate.organizationId)
          .eq("person_id", candidate.personId)
          .eq("kind", "eod")
          .eq("report_date", candidate.date)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing.error) throw new Error("candidate lookup failed");
        if (existing.data && (existing.data.submitted_at || !["draft", "rejected"].includes(String(existing.data.status)))) {
          result.skipped += 1;
          addReason(result, "already_submitted");
          continue;
        }
        if (existing.data) {
          const saved = existing.data.structured_report as Record<string, unknown> | null | undefined;
          const editing = Boolean(
            (typeof saved?.summary === "string" && saved.summary.trim())
            || (Array.isArray(saved?.completed) && saved.completed.length)
            || (Array.isArray(saved?.inProgress) && saved.inProgress.length)
            || (Array.isArray(saved?.next) && saved.next.length),
          );
          if (editing) {
            result.skipped += 1;
            addReason(result, "employee_editing");
            continue;
          }
          const preparedAt = Date.parse(String(existing.data.prepared_at ?? ""));
          if (Number.isFinite(preparedAt) && at.getTime() - preparedAt < SCHEDULED_EOD_RETRY_MS) {
            result.skipped += 1;
            addReason(result, "recently_prepared");
            continue;
          }
        }

        result.attempted += 1;
        result.employees += 1;
        await prepareWorkOsEod(access, candidate.personId, candidate.date, "scheduled");
        result.prepared += 1;
      } catch {
        result.failed += 1;
        addReason(result, "prepare_failed");
      }
    }

    candidateOffset = candidates.length <= consumed ? 0 : (candidateOffset + consumed) % candidates.length;
    return result;
  })().finally(() => { scheduledRun = null; });
  scheduledRun = run;
  return run;
}
