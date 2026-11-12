import { localDateForTimezone } from "@/modules/work-os/companion";
import type { Json } from "@/lib/work-os-internal";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { isoInstant } from "@/lib/work-os-activity-interval-projection";
import {
  activityIntervalRetryBlocked,
  activityIntervalSlotKey,
  ensureActivityInterval,
  type ActivityIntervalRecord,
} from "@/lib/work-os-activity-intervals";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { dailyPlanGoalText, deliverWorkdayPrompt, getWorkday } from "@/lib/work-os-workday";

export const SCHEDULED_RECAP_MAX_SLOTS = 4;
export const SCHEDULED_RECAP_FAILURE_BACKOFF_MS = 15 * 60_000;

type Workday = Awaited<ReturnType<typeof getWorkday>>;
type EnsureResult = Awaited<ReturnType<typeof ensureActivityInterval>>;
type DeliverResult = Awaited<ReturnType<typeof deliverWorkdayPrompt>>;

export type ScheduledRecapDeps = {
  getWorkday: (access: WorkOsAccess, at: Date) => Promise<Workday>;
  ensure: (access: WorkOsAccess, input: { promptDueAt?: string; at?: Date }) => Promise<EnsureResult>;
  deliver: (access: WorkOsAccess, at: Date) => Promise<DeliverResult>;
  loadSlot: (access: WorkOsAccess, slotKey: string) => Promise<ActivityIntervalRecord | null>;
};

/** A failed or empty row waits out the retry window. A ready recap on a
 * goal-less plan hold also waits, so a failed goal suggestion cannot spend a
 * model call every scheduler tick. */
export function scheduledRecapRetryBlocked(
  row: ActivityIntervalRecord | null,
  atMs: number,
  options: { promptKind?: string | null; planHasGoal?: boolean } = {},
) {
  if (!row) return false;
  if (activityIntervalRetryBlocked(row, atMs)) return true;
  const updatedAt = Date.parse(isoInstant(row.updated_at) ?? "");
  if (!Number.isFinite(updatedAt) || atMs - updatedAt >= SCHEDULED_RECAP_FAILURE_BACKOFF_MS) return false;
  return String(row.generation_status ?? "") === "ready" && options.promptKind === "plan" && options.planHasGoal === false;
}

async function loadSlot(access: WorkOsAccess, slotKey: string) {
  const { data, error } = await createAdminClient().from("work_activity_intervals").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .eq("slot_key", slotKey).maybeSingle();
  if (error) throw new Error(`load scheduled activity interval: ${error.message}`);
  return (data as ActivityIntervalRecord | null) ?? null;
}

const defaultDeps: ScheduledRecapDeps = {
  getWorkday,
  ensure: ensureActivityInterval,
  deliver: deliverWorkdayPrompt,
  loadSlot,
};

/** Settles every due recap slot for one employee, bounded so one run cannot
 * replay a whole day. It never writes check-ins or substantive updates. */
export async function settleDueActivityRecaps(
  access: WorkOsAccess,
  options: { at: Date; maxSlots?: number; deps?: Partial<ScheduledRecapDeps> },
) {
  const deps = { ...defaultDeps, ...options.deps };
  const maxSlots = Math.max(1, Math.min(SCHEDULED_RECAP_MAX_SLOTS, Math.floor(options.maxSlots ?? SCHEDULED_RECAP_MAX_SLOTS)));
  const at = options.at;
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let advanced = 0;
  const results: Array<{ slotKey: string; status: string; advanced: boolean }> = [];
  let lastSlotKey: string | null = null;

  for (let index = 0; index < maxSlots; index += 1) {
    const workday = await deps.getWorkday(access, at);
    const prompt = workday.prompt;
    if (!prompt.nextPromptAt || !["follow_up", "hourly_fallback", "plan"].includes(String(prompt.kind))) break;
    const dueMs = Date.parse(prompt.nextPromptAt);
    if (!Number.isFinite(dueMs) || dueMs > at.getTime() + 60_000) break;

    const slotKey = activityIntervalSlotKey(String(workday.session?.id), prompt.nextPromptAt);
    if (slotKey === lastSlotKey) break;
    const row = await deps.loadSlot(access, slotKey);
    if (scheduledRecapRetryBlocked(row, at.getTime(), {
      promptKind: prompt.kind,
      planHasGoal: Boolean(dailyPlanGoalText(workday.plan)),
    })) break;

    const result = await deps.ensure(access, { promptDueAt: prompt.nextPromptAt, at });
    if (result.status === "no_prompt") break;
    if (result.status === "failed") {
      failed += 1;
      results.push({ slotKey, status: "failed", advanced: false });
      break;
    }
    if (result.status === "ready") generated += 1;
    else if (result.status === "unavailable") skipped += 1;

    /* A goal-less plan hold is the day's first prompt. Once its recap exists,
       the hold is not a delivery slot; stop and let the next run retry the
       goal suggestion after the backoff. */
    const after = await deps.getWorkday(access, at);
    if (after.prompt.kind === "plan" && after.prompt.nextPromptAt === prompt.nextPromptAt) {
      results.push({ slotKey, status: result.status, advanced: false });
      break;
    }

    const delivery = await deps.deliver(access, at);
    if (delivery.delivered) advanced += 1;
    results.push({ slotKey, status: result.status, advanced: delivery.delivered });
    lastSlotKey = slotKey;

    const nextMs = Date.parse(after.prompt.nextPromptAt ?? "");
    if (!Number.isFinite(nextMs) || nextMs > at.getTime() + 60_000 || nextMs === dueMs) break;
  }

  return { generated, skipped, failed, advanced, results };
}

export function scheduledRecapEligible(input: {
  featureFlags: Record<string, boolean>;
  consent: { tracking: boolean; screenshotAnalysis: boolean };
  worktivityEmployeeId: string | null;
  exceptionKind: string | null;
}) {
  return input.featureFlags.screenshot_summaries === true
    && input.featureFlags.activity_intervals !== false
    && input.consent.tracking
    && input.consent.screenshotAnalysis
    && Boolean(input.worktivityEmployeeId)
    && input.exceptionKind !== "leave";
}

export type ScheduledRecapRunResult = {
  attempted: number;
  employees: number;
  generated: number;
  skipped: number;
  failed: number;
  results: Array<{
    organizationId: string;
    personId: string;
    status: string;
    generated: number;
    skipped: number;
    failed: number;
  }>;
};

let scheduledRun: Promise<ScheduledRecapRunResult> | null = null;
/** Rotates the candidate window so an ineligible prefix cannot starve the
 * employees beyond it on every five-minute run. */
let candidateOffset = 0;

/** Bounded cron work for server-side recaps. Every employee stays fail-closed
 * behind the same flags and consent the employee path uses. */
export async function runScheduledActivityRecaps(limit = 24, at = new Date()): Promise<ScheduledRecapRunResult> {
  if (!process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY || !process.env.CRON_SECRET) {
    throw new Error("scheduled activity recaps are not ready: encryption key and cron secret are required");
  }
  if (scheduledRun) return scheduledRun;
  const run = (async (): Promise<ScheduledRecapRunResult> => {
    const db = createAdminClient();
    const pageSize = Math.max(100, Math.min(200, Math.floor(limit) * 4));
    const since = new Date(at.getTime() - 24 * 60 * 60_000).toISOString();
    const sessions = await db.from("work_sessions")
      .select("id,organization_id,person_id,timezone,clocked_in_at")
      .in("state", ["clocked_in", "active"])
      .not("clocked_in_at", "is", null)
      .gte("clocked_in_at", since)
      .or(`next_fallback_at.lte.${at.toISOString()},last_prompt_at.is.null`)
      .order("next_fallback_at", { ascending: true, nullsFirst: true })
      .order("clocked_in_at", { ascending: true })
      .range(candidateOffset, candidateOffset + pageSize - 1);
    if (sessions.error) throw new Error(`load scheduled recap candidates: ${sessions.error.message}`);
    const candidateRows = (sessions.data ?? []) as Array<Record<string, unknown>>;
    let consumed = 0;

    const organizations = new Map<string, { organizationId: string; actorId: string | null; featureFlags: Record<string, boolean> }>();
    const people = new Map<string, { active: boolean; worktivityEmployeeId: string | null }>();
    const seen = new Set<string>();
    const results: ScheduledRecapRunResult["results"] = [];
    let attempted = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const session of candidateRows) {
      if (results.length >= limit) break;
      consumed += 1;
      const organizationId = String(session.organization_id ?? "");
      const personId = String(session.person_id ?? "");
      if (!organizationId || !personId) continue;
      const key = `${organizationId}:${personId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let organization = organizations.get(organizationId);
      if (!organization) {
        const loaded = await db.from("work_organizations")
          .select("feature_flags,legacy_owner_id,created_by").eq("id", organizationId).maybeSingle();
        if (loaded.error) continue;
        const flags = (loaded.data?.feature_flags ?? {}) as Json;
        organization = {
          organizationId,
          actorId: (loaded.data?.legacy_owner_id || loaded.data?.created_by || null) as string | null,
          featureFlags: flags as Record<string, boolean>,
        };
        organizations.set(organizationId, organization);
      }

      let person = people.get(key);
      if (!person) {
        const loaded = await db.from("work_people")
          .select("active,worktivity_employee_id").eq("organization_id", organizationId).eq("id", personId).maybeSingle();
        if (loaded.error) continue;
        person = {
          active: loaded.data?.active !== false,
          worktivityEmployeeId: (loaded.data?.worktivity_employee_id as string | null) ?? null,
        };
        people.set(key, person);
      }

      const timezone = String(session.timezone ?? "UTC");
      const localDate = localDateForTimezone(at, timezone);
      const exception = await db.from("work_schedule_exceptions").select("kind")
        .eq("organization_id", organizationId).eq("person_id", personId)
        .eq("exception_date", localDate).maybeSingle();
      if (exception.error) continue;
      const consent = await employeeTrackingConsent(organizationId, personId);
      if (!person.active || !scheduledRecapEligible({
        featureFlags: organization.featureFlags,
        consent,
        worktivityEmployeeId: person.worktivityEmployeeId,
        exceptionKind: (exception.data?.kind as string | null) ?? null,
      })) continue;

      if (!organization.actorId) continue;
      attempted += 1;
      const access = {
        ctx: { user: { id: organization.actorId }, profile: { id: organization.actorId } },
        organizationId,
        organizationName: "",
        organizationOwnerId: organization.actorId,
        role: "admin",
        personId,
        membershipId: `system-activity-recap-schedule:${personId}`,
        featureFlags: organization.featureFlags,
        workspaces: [],
      } as unknown as WorkOsAccess;

      try {
        const settled = await settleDueActivityRecaps(access, { at });
        generated += settled.generated;
        skipped += settled.skipped;
        failed += settled.failed;
        results.push({
          organizationId,
          personId,
          status: settled.failed ? "failed" : settled.generated ? "generated" : settled.skipped ? "skipped" : "idle",
          generated: settled.generated,
          skipped: settled.skipped,
          failed: settled.failed,
        });
      } catch (cause) {
        failed += 1;
        results.push({
          organizationId,
          personId,
          status: cause instanceof Error ? cause.message : "failed",
          generated: 0,
          skipped: 0,
          failed: 1,
        });
      }
    }

    candidateOffset = candidateRows.length < pageSize ? 0 : candidateOffset + consumed;
    return { attempted, employees: results.length, generated, skipped, failed, results };
  })().finally(() => { scheduledRun = null; });
  scheduledRun = run;
  return run;
}
