import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";

/** How long the provider may go without producing a new activity sample before
 * Work OS treats the employee as unreachable rather than merely idle.
 *
 * Worktivity's `idle` status (3) still produces samples, so reading or thinking
 * keeps the sample fresh and never trips this. Only a real absence — network
 * loss, a sleeping machine, or a force-closed tracker — freezes it. */
export const NO_ACTIVITY_THRESHOLD_MS = 5 * 60_000;

const ACTIVE_STATUSES = new Set(["clock_in", "working"]);

export interface InactivityInput {
  status: string;
  activityObservedAt?: string | null;
}

interface MarkerRow {
  event_type: string;
  observed_at: string;
}

/** The newest marker for this session, so a gap is opened once and closed once. */
async function latestMarker(sessionId: string) {
  const { data, error } = await createAdminClient()
    .from("work_session_events")
    .select("event_type,observed_at")
    .eq("session_id", sessionId)
    .in("event_type", ["no_activity", "activity_resumed"])
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`load inactivity marker: ${error.message}`);
  return (data as MarkerRow | null) ?? null;
}

async function writeMarker(
  access: WorkOsAccess,
  session: Record<string, any>,
  eventType: "no_activity" | "activity_resumed",
  observedAt: string,
  idempotencyKey: string,
) {
  const { error } = await createAdminClient().from("work_session_events").insert({
    organization_id: access.organizationId,
    person_id: access.personId,
    session_id: session.id,
    // Synthetic markers: the session state does not move, and attendance stays
    // whatever the provider says. They exist only to describe the gap.
    event_type: eventType,
    from_state: session.state ?? null,
    to_state: session.state ?? null,
    source: "system",
    observed_at: observedAt,
    idempotency_key: idempotencyKey,
    metadata: { reason: "no fresh provider activity" },
  });
  // A duplicate marker is the same gap; the unique key already recorded it.
  if (error && !/duplicate/i.test(error.message)) {
    throw new Error(`record ${eventType}: ${error.message}`);
  }
}

export type InactivityAction = "open" | "close" | null;

/** The decision, separated from the database work so the threshold behaviour is
 * testable: `open` starts a gap, `close` ends one, null leaves it alone. */
export function inactivityAction(input: {
  status: string;
  activityObservedAt?: string | null;
  now: Date;
  open: boolean;
}): InactivityAction {
  const activityAt = input.activityObservedAt ? Date.parse(input.activityObservedAt) : Number.NaN;
  if (input.status === "unknown" || !Number.isFinite(activityAt)) return null;
  const quietMs = input.now.getTime() - activityAt;
  if (!input.open) {
    // Idle and break are deliberately excluded: idle is not inactivity.
    if (!ACTIVE_STATUSES.has(input.status)) return null;
    return quietMs >= NO_ACTIVITY_THRESHOLD_MS ? "open" : null;
  }
  return quietMs < NO_ACTIVITY_THRESHOLD_MS ? "close" : null;
}

/** Open or close a no-activity gap for this session.
 *
 * Runs from the attendance sync, which the companion polls and the VPS timer
 * runs every five minutes, so it works even when the employee's machine is
 * offline. It never changes attendance: a disconnected employee keeps whatever
 * state the provider last reported.
 */
export async function recordInactivityGap(
  access: WorkOsAccess,
  session: Record<string, any> | null,
  input: InactivityInput,
  at: Date = new Date(),
) {
  if (!session?.id) return null;
  if (!["clocked_in", "active", "paused", "eod_due"].includes(String(session.state))) return null;
  if (input.status === "unknown") return null;

  const marker = await latestMarker(String(session.id));
  const action = inactivityAction({
    status: input.status,
    activityObservedAt: input.activityObservedAt,
    now: at,
    open: marker?.event_type === "no_activity",
  });
  if (!action) return null;

  if (action === "open") {
    const activityAt = Date.parse(String(input.activityObservedAt));
    const quietFrom = new Date(activityAt + NO_ACTIVITY_THRESHOLD_MS).toISOString();
    await writeMarker(access, session, "no_activity", quietFrom, `worktivity:no-activity:${session.id}:${quietFrom}`);
    return "no_activity" as const;
  }

  const resumedAt = at.toISOString();
  await writeMarker(access, session, "activity_resumed", resumedAt, `worktivity:activity:${session.id}:${resumedAt}`);
  return "activity_resumed" as const;
}
