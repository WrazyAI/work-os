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
import { dailyPlanGoalText, deliverWorkdayPrompt, getWorkday, type WorkdayPromptSlot } from "@/lib/work-os-workday";

export const SCHEDULED_RECAP_MAX_SLOTS = 4;
export const SCHEDULED_RECAP_FAILURE_BACKOFF_MS = 15 * 60_000;

export type RecapOutcome = "nothing_due" | "ineligible" | "awaiting_evidence" | "empty" | "generated" | "already_ready" | "failed" | "slot_changed";
export type RecapReason = "feature_disabled" | "consent_required" | "no_mapping" | "inactive" | "leave" | "missing_actor" | "nothing_due" | "plan_hold" | "retry_backoff" | "no_usable_frames" | "evidence_timeout" | "daily_cap" | "no_reviewable_interval" | "candidate_lookup_failed" | "generation_failed" | "delivery_failed" | "slot_changed";
type RecapCoverage = {
  scanned: number; eligible: number; dueSlotsObserved: number;
  outcomes: Record<RecapOutcome, number>;
  reasons: Partial<Record<RecapReason, number>>;
  readyLatencyMs: { count: number; sum: number; max: number };
};
function recapCoverage(): RecapCoverage {
  return { scanned: 0, eligible: 0, dueSlotsObserved: 0,
    outcomes: { nothing_due: 0, ineligible: 0, awaiting_evidence: 0, empty: 0, generated: 0, already_ready: 0, failed: 0, slot_changed: 0 }, reasons: {}, readyLatencyMs: { count: 0, sum: 0, max: 0 } };
}
function recordReason(coverage: RecapCoverage, reason: RecapReason) {
  coverage.reasons[reason] = (coverage.reasons[reason] ?? 0) + 1;
}

type Workday = Awaited<ReturnType<typeof getWorkday>>;
type EnsureResult = Awaited<ReturnType<typeof ensureActivityInterval>>;
type DeliverResult = Awaited<ReturnType<typeof deliverWorkdayPrompt>>;

export type ScheduledRecapDeps = {
  getWorkday: (access: WorkOsAccess, at: Date) => Promise<Workday>;
  ensure: (access: WorkOsAccess, input: { promptDueAt?: string; at?: Date; expectedSlot?: WorkdayPromptSlot }) => Promise<EnsureResult>;
  deliver: (access: WorkOsAccess, at: Date, expectedSlot: WorkdayPromptSlot) => Promise<DeliverResult>;
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
  if (row.generation_status === "unavailable" && ["no_usable_frames", "evidence_timeout"].includes(String(row.failure_reason)) && options.promptKind !== "plan") return false;
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
  const coverage = recapCoverage();
  const results: Array<{ slotKey: string; status: string; advanced: boolean }> = [];
  let lastSlotKey: string | null = null;

  for (let index = 0; index < maxSlots; index += 1) {
    const workday = await deps.getWorkday(access, at);
    const prompt = workday.prompt;
    if (!prompt.nextPromptAt || !["follow_up", "hourly_fallback", "plan"].includes(String(prompt.kind))) {
      if (index === 0) { coverage.outcomes.nothing_due++; recordReason(coverage, "nothing_due"); }
      break;
    }
    const dueMs = Date.parse(prompt.nextPromptAt);
    if (!Number.isFinite(dueMs) || dueMs > at.getTime()) {
      if (index === 0) { coverage.outcomes.nothing_due++; recordReason(coverage, "nothing_due"); }
      break;
    }

    const slotKey = activityIntervalSlotKey(String(workday.session?.id), prompt.nextPromptAt);
    if (slotKey === lastSlotKey) break;
    coverage.dueSlotsObserved++;
    const row = await deps.loadSlot(access, slotKey);
    if (scheduledRecapRetryBlocked(row, at.getTime(), {
      promptKind: prompt.kind,
      planHasGoal: Boolean(dailyPlanGoalText(workday.plan)),
    })) {
      coverage.outcomes[row?.failure_reason === "awaiting_evidence" ? "awaiting_evidence" : "nothing_due"]++;
      recordReason(coverage, "retry_backoff");
      break;
    }

    const expectedSlot = { sessionId: String(workday.session?.id), promptDueAt: new Date(dueMs).toISOString() };
    const result = await deps.ensure(access, { promptDueAt: prompt.nextPromptAt, at, expectedSlot });
    if (result.status === "awaiting_evidence") { coverage.outcomes.awaiting_evidence++; break; }
    if (result.status === "no_prompt" && !result.mayAdvance) {
      const changed = result.reason === "slot_changed";
      coverage.outcomes[changed ? "slot_changed" : "nothing_due"]++;
      recordReason(coverage, changed ? "slot_changed" : "nothing_due");
      break;
    }
    if (result.status === "failed") {
      failed += 1;
      coverage.outcomes.failed++; recordReason(coverage, "generation_failed");
      results.push({ slotKey, status: "failed", advanced: false });
      break;
    }
    if (!result.mayAdvance || result.slot?.sessionId !== expectedSlot.sessionId || Date.parse(result.slot.promptDueAt) !== dueMs) {
      coverage.outcomes.slot_changed++; recordReason(coverage, "slot_changed"); break;
    }
    if (result.status === "ready") {
      if (result.readyTransition === "new") {
        generated++; coverage.outcomes.generated++;
        const latency = Date.parse(isoInstant(result.interval?.generated_at) ?? "") - Date.parse(isoInstant(result.interval?.prompt_due_at) ?? "");
        if (Number.isFinite(latency) && latency >= 0) {
          coverage.readyLatencyMs.count++; coverage.readyLatencyMs.sum += latency;
          coverage.readyLatencyMs.max = Math.max(coverage.readyLatencyMs.max, latency);
        }
      } else coverage.outcomes.already_ready++;
    } else if (result.reason === "evidence_timeout") {
      failed++; coverage.outcomes.failed++; recordReason(coverage, "evidence_timeout");
    } else if (result.reason === "no_usable_frames") {
      skipped++; coverage.outcomes.empty++; recordReason(coverage, "no_usable_frames");
    } else {
      coverage.outcomes.ineligible++;
      recordReason(coverage, result.reason === "daily_cap" ? "daily_cap" : result.reason === "no_reviewable_interval" ? "no_reviewable_interval" : "feature_disabled");
    }

    /* A goal-less plan hold is the day's first prompt. Once its recap exists,
       the hold is not a delivery slot; stop and let the next run retry the
       goal suggestion after the backoff. */
    /* Generation already happened. A later read or delivery failure must not
       throw away the coverage that generation earned. */
    let after: Workday;
    try {
      after = await deps.getWorkday(access, at);
    } catch {
      failed += 1; coverage.outcomes.failed++; recordReason(coverage, "delivery_failed");
      results.push({ slotKey, status: result.status, advanced: false });
      break;
    }
    if (after.prompt.kind === "plan" && after.prompt.nextPromptAt === prompt.nextPromptAt) {
      recordReason(coverage, "plan_hold");
      results.push({ slotKey, status: result.status, advanced: false });
      break;
    }

    let delivery: DeliverResult;
    try {
      delivery = await deps.deliver(access, at, expectedSlot);
    } catch {
      failed += 1; coverage.outcomes.failed++; recordReason(coverage, "delivery_failed");
      results.push({ slotKey, status: result.status, advanced: false });
      break;
    }
    if (delivery.delivered) advanced += 1;
    results.push({ slotKey, status: result.status, advanced: delivery.delivered });
    lastSlotKey = slotKey;
    if (!delivery.delivered) { recordReason(coverage, "slot_changed"); break; }

    const nextMs = Date.parse(after.prompt.nextPromptAt ?? "");
    if (!Number.isFinite(nextMs) || nextMs > at.getTime() + 60_000 || nextMs === dueMs) break;
  }

  return { generated, skipped, failed, advanced, results, coverage };
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
  coverage: RecapCoverage;
};

let scheduledRun: Promise<ScheduledRecapRunResult> | null = null;
/** Rotates the candidate window so an ineligible prefix cannot starve the
 * employees beyond it on every five-minute run. */
let candidateOffset = 0;

/** Bounded cron work for server-side recaps. Every employee stays fail-closed
 * behind the same flags and consent the employee path uses. */
export async function runScheduledActivityRecaps(limit = 24, at = new Date(), overrides: Partial<{ consent: typeof employeeTrackingConsent; settle: typeof settleDueActivityRecaps }> = {}): Promise<ScheduledRecapRunResult> {
  const deps = { consent: employeeTrackingConsent, settle: settleDueActivityRecaps, ...overrides };
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
      .or([
        `next_fallback_at.lte.${at.toISOString()}`,
        `and(last_prompt_at.is.null,first_follow_up_at.lte.${at.toISOString()})`,
        "and(last_prompt_at.is.null,first_follow_up_at.is.null)",
      ].join(","))
      .order("next_fallback_at", { ascending: true, nullsFirst: true })
      .order("clocked_in_at", { ascending: true })
      .range(candidateOffset, candidateOffset + pageSize - 1);
    if (sessions.error) throw new Error(`load scheduled recap candidates: ${sessions.error.message}`);
    const candidateRows = (sessions.data ?? []) as Array<Record<string, unknown>>;
    let consumed = 0;

    const organizations = new Map<string, { organizationId: string; actorId: string | null; featureFlags: Record<string, boolean> }>();
    const people = new Map<string, { active: boolean; worktivityEmployeeId: string | null }>();
    const seen = new Set<string>();
    const coverage = recapCoverage();
    let attempted = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const session of candidateRows) {
      if (attempted >= limit) break;
      consumed += 1;
      const organizationId = String(session.organization_id ?? "");
      const personId = String(session.person_id ?? "");
      if (!organizationId || !personId) continue;
      const key = `${organizationId}:${personId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      coverage.scanned++;

      try {

      let organization = organizations.get(organizationId);
      if (!organization) {
        const loaded = await db.from("work_organizations")
          .select("feature_flags,legacy_owner_id,created_by").eq("id", organizationId).maybeSingle();
        if (loaded.error) throw new Error("candidate lookup failed");
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
        if (loaded.error) throw new Error("candidate lookup failed");
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
      if (exception.error) throw new Error("candidate lookup failed");
      const consent = await deps.consent(organizationId, personId);
      if (!person.active || !scheduledRecapEligible({
        featureFlags: organization.featureFlags,
        consent,
        worktivityEmployeeId: person.worktivityEmployeeId,
        exceptionKind: (exception.data?.kind as string | null) ?? null,
      })) {
        coverage.outcomes.ineligible++;
        recordReason(coverage, !person.active ? "inactive" : organization.featureFlags.screenshot_summaries !== true || organization.featureFlags.activity_intervals === false ? "feature_disabled" : !consent.tracking || !consent.screenshotAnalysis ? "consent_required" : !person.worktivityEmployeeId ? "no_mapping" : "leave");
        continue;
      }

      if (!organization.actorId) { coverage.outcomes.ineligible++; recordReason(coverage, "missing_actor"); continue; }
      coverage.eligible++;
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
        const settled = await deps.settle(access, { at });
        generated += settled.generated;
        skipped += settled.skipped;
        failed += settled.failed;
        coverage.dueSlotsObserved += settled.coverage.dueSlotsObserved;
        for (const outcome of Object.keys(coverage.outcomes) as RecapOutcome[]) coverage.outcomes[outcome] += settled.coverage.outcomes[outcome];
        for (const reason of Object.keys(settled.coverage.reasons) as RecapReason[]) coverage.reasons[reason] = (coverage.reasons[reason] ?? 0) + (settled.coverage.reasons[reason] ?? 0);
        coverage.readyLatencyMs.count += settled.coverage.readyLatencyMs.count;
        coverage.readyLatencyMs.sum += settled.coverage.readyLatencyMs.sum;
        coverage.readyLatencyMs.max = Math.max(coverage.readyLatencyMs.max, settled.coverage.readyLatencyMs.max);
      } catch {
        failed += 1;
        coverage.outcomes.failed++; recordReason(coverage, "generation_failed");
      }
      } catch {
        failed++; coverage.outcomes.failed++; recordReason(coverage, "candidate_lookup_failed");
      }
    }

    candidateOffset = candidateRows.length < pageSize ? 0 : candidateOffset + consumed;
    return { attempted, employees: attempted, generated, skipped, failed, coverage };
  })().finally(() => { scheduledRun = null; });
  scheduledRun = run;
  return run;
}
