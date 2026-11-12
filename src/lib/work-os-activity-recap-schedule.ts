import type { WorkOsAccess } from "@/lib/work-os-api";
import { isoInstant } from "@/lib/work-os-activity-interval-projection";
import {
  activityIntervalSlotKey,
  ensureActivityInterval,
  type ActivityIntervalRecord,
} from "@/lib/work-os-activity-intervals";
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
  const updatedAt = Date.parse(isoInstant(row.updated_at) ?? "");
  if (!Number.isFinite(updatedAt) || atMs - updatedAt >= SCHEDULED_RECAP_FAILURE_BACKOFF_MS) return false;
  const status = String(row.generation_status ?? "");
  if (status === "failed" || status === "unavailable") return true;
  return status === "ready" && options.promptKind === "plan" && options.planHasGoal === false;
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
