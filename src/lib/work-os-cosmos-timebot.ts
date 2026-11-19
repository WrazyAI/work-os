import { createAdminClient } from "@/lib/supabase/admin";

/** The four employee-facing milestones worth posting. Everything else in
 * work_session_events (`late_reason`, `mark_active`, `worktivity_reopened`,
 * `resolve_missed_clock_out`, ...) is a system or correction event and would
 * just add noise to a human punch-clock channel. */
export const COSMOS_TIMEBOT_EVENTS = ["clock_in", "pause", "resume", "clock_out", "no_activity", "activity_resumed"] as const;
export type CosmosTimebotEvent = (typeof COSMOS_TIMEBOT_EVENTS)[number];

/** Channel vocabulary. `pause`/`resume` are Work OS's names for a break; the
 * team writes `break` and `back`. `inactive` is not a Work OS state: it is how a
 * clock-out reads when it happened before the end of the shift, because a
 * dropped connection produces an exact provider clock-out that is
 * indistinguishable from leaving for the day. See `classifyTimebotEvent`. */

export type CosmosDeliveryOutcome = "sent" | "retry" | "dead";

const REQUEST_TIMEOUT_MS = 5_000;
const STALE_SENDING_MS = 5 * 60_000;
/** Lines delivered within this window are not marked; beyond it they are. */
export const DELAY_MARKER_MS = 15 * 60_000;

/** 1m, 5m, 15m, 1h, 6h — then hold at 6h. A valid transition is never discarded
 * for running out of attempts; only a permanent rejection makes it dead. */
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

type TimebotEnv = { COSMOS_TIMEBOT_WEBHOOK_URL?: string; COSMOS_TIMEBOT_ORGANIZATION_ID?: string };

function timebotWebhookUrl(env?: TimebotEnv) {
  return (env ?? (process.env as unknown as TimebotEnv)).COSMOS_TIMEBOT_WEBHOOK_URL?.trim() ?? "";
}

/** The destination is one global channel, so the deployment must name the
 * organization it speaks for. Without this, a second tenant's attendance would
 * land in the same channel under the same bot name. */
function timebotOrganizationId(env?: TimebotEnv) {
  return (env ?? (process.env as unknown as TimebotEnv)).COSMOS_TIMEBOT_ORGANIZATION_ID?.trim() ?? "";
}

export function cosmosTimebotConfigured(env?: TimebotEnv) {
  return Boolean(timebotWebhookUrl(env) && timebotOrganizationId(env));
}

interface LocalStamp {
  date: string;
  time: string;
  day: string;
}

function localStamp(date: Date, timezone: string | null): LocalStamp {
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timezone || "UTC");
  } catch {
    parts = format("UTC");
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const month = Number(get("month"));
  const dayOfMonth = Number(get("day"));
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, Math.max(month, 1) - 1, 1)),
  );
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    day: `${dayOfMonth} ${monthName}`,
  };
}

/** `20m`, `3h`, `3d` — a reader needs the size of the delay, not seconds. */
export function humanDelay(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export type TimebotMessageKind = "in" | "break" | "back" | "out" | "no activity" | "activity";

export interface TimebotClassification {
  kind: TimebotMessageKind;
  /** The event this one resumes from, when it has one. */
  previousObservedAt: string | null;
}

/** Decide what a Work OS event should say in the channel.
 *
 * A clock-out only reads as `out` when the session had already reached eod_due,
 * i.e. the shift was over. Every other clock-out reads as `inactive`, because a
 * network drop produces an exact provider clock-out that cannot be told apart
 * from an early departure at the moment it arrives.
 *
 * A clock-in that resumes a clock-out from the same shift reads as `back`, not a
 * second `in`, and a break return reads as `back` with the break's length.
 */
export function classifyTimebotEvent(input: {
  eventType: string;
  fromState?: string | null;
  previousObservedAt?: string | null;
}): TimebotClassification | null {
  const event = input.eventType;
  if (!(COSMOS_TIMEBOT_EVENTS as readonly string[]).includes(event)) return null;
  const previous = input.previousObservedAt ?? null;
  if (event === "clock_out") {
    return { kind: input.fromState === "eod_due" ? "out" : "no activity", previousObservedAt: null };
  }
  if (event === "pause") return { kind: "break", previousObservedAt: null };
  if (event === "resume") return { kind: "back", previousObservedAt: previous };
  if (event === "no_activity") return { kind: "no activity", previousObservedAt: null };
  if (event === "activity_resumed") return { kind: "activity", previousObservedAt: previous };
  // A clock-in that resumes a same-shift exit is the return of activity, not a
  // second start of the day.
  return { kind: previous ? "activity" : "in", previousObservedAt: previous };
}

/** Render one channel line.
 *
 * Age never removes a transition: the line is always posted. What age changes is
 * whether the reader is told the delivery was late, and — when the event falls
 * on an earlier local day — whether the absolute date is shown, because Cosmos's
 * Today/Yesterday dividers describe the posting time, not the event time.
 */
export function renderTimebotMessage(input: {
  displayName: string;
  eventType: string;
  observedAt: string;
  timezone?: string | null;
  /** Delivery time. Defaults to now; tests pass it explicitly. */
  now?: string | Date;
  /** The session state the event left, used to tell `out` from `inactive`. */
  fromState?: string | null;
  /** The event this one resumes from, used for the `back` gap. */
  previousObservedAt?: string | null;
}): string | null {
  const classification = classifyTimebotEvent(input);
  if (!classification) return null;
  const name = input.displayName.trim().split(/\s+/)[0];
  if (!name) return null;

  const observed = new Date(input.observedAt);
  if (Number.isNaN(observed.getTime())) return `--:-- ${name} — ${classification.kind}`;

  const delivered = input.now === undefined ? new Date() : new Date(input.now);
  const deliveredValid = !Number.isNaN(delivered.getTime());
  // A bad delivery timestamp must not throw: fall back to the event's own time,
  // which renders an unmarked line rather than a 500.
  const reference = deliveredValid ? delivered : observed;
  const timezone = input.timezone ?? null;
  const observedStamp = localStamp(observed, timezone);
  const deliveredStamp = localStamp(reference, timezone);
  const lateMs = deliveredValid ? delivered.getTime() - observed.getTime() : 0;
  const delayed = lateMs >= DELAY_MARKER_MS;

  // The date is independent of the delay marker: a 23:58 clock-in delivered at
  // 00:02 is only four minutes late, but Cosmos's "Today" divider would file it
  // under the wrong day, so it still needs the absolute date.
  const prefix = observedStamp.date !== deliveredStamp.date ? `${observedStamp.day} ` : "";
  const delaySuffix = delayed ? ` (delayed ${humanDelay(lateMs)})` : "";

  let gapSuffix = "";
  const previous = classification.previousObservedAt ? Date.parse(classification.previousObservedAt) : Number.NaN;
  if (Number.isFinite(previous)) {
    const gap = observed.getTime() - previous;
    if (gap >= 60_000) gapSuffix = ` (${humanDelay(gap)})`;
  }

  return `${prefix}${observedStamp.time} ${name} — ${classification.kind}${gapSuffix}${delaySuffix}`;
}

/** Cosmos documents no idempotency key and no delivery receipt, so a retry of an
 * ambiguous timeout can duplicate a line. Treat 5xx/429/408/network as retryable
 * and every other 4xx as permanent: a wrong URL or removed integration will not
 * fix itself. */
export function classifyTimebotDelivery(status: number | null): CosmosDeliveryOutcome {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "sent";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  if (status >= 400 && status < 500) return "dead";
  return "retry";
}

export function timebotBackoffMs(attempts: number) {
  const index = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index];
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function postTimebotMessage(
  message: string,
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ status: number | null; error?: string }> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Drain the body so the socket is released; Cosmos returns `{}`.
    await response.text().catch(() => "");
    return { status: response.status };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : "request failed" };
  }
}

interface OutboxRow {
  id: string;
  organization_id: string;
  person_name: string;
  timezone: string | null;
  event_type: string;
  observed_at: string;
  attempts: number;
  from_state: string | null;
  previous_observed_at: string | null;
}

type Db = ReturnType<typeof createAdminClient>;

/** The cutover for this organization.
 *
 * The migration seeds it for organizations that already exist. A newer
 * organization may have no row yet, and the trigger cannot write one: an
 * enqueue that fails would roll the state insert back with it, leaving the
 * event recorded but permanently outside recovery. So the boundary is derived
 * from the event log itself — the earliest recorded transition — which is the
 * one fact that survives a failed enqueue. */
async function readTimebotActivation(db: Db, organizationId: string): Promise<string | null> {
  const state = await db
    .from("work_notification_state")
    .select("timebot_activated_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (state.error) throw new Error(`load timebot activation: ${state.error.message}`);
  const recorded = (state.data as { timebot_activated_at?: string } | null)?.timebot_activated_at;
  if (recorded) return recorded;

  const earliest = await db
    .from("work_session_events")
    .select("recorded_at")
    .eq("organization_id", organizationId)
    .order("recorded_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (earliest.error) throw new Error(`derive timebot activation: ${earliest.error.message}`);
  const derived = (earliest.data as { recorded_at?: string } | null)?.recorded_at;
  if (!derived) return null;

  // Best effort: caching the derived boundary is an optimisation, not a
  // correctness requirement, so a failed write must not stop the drain.
  try {
    await db
      .from("work_notification_state")
      .insert({ organization_id: organizationId, timebot_activated_at: derived });
  } catch {
    // ignored on purpose
  }
  return derived;
}

/** The query shim reports failures as `{ error }` instead of throwing. Ignoring
 * that after a successful POST leaves the row in `sending`, so it is reclaimed
 * five minutes later and posted again. Surface it instead. */
async function settle(db: Db, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("work_notification_outbox").update(patch).eq("id", id);
  if (error) throw new Error(`record timebot delivery: ${error.message}`);
}

export interface TimebotFlushSummary {
  configured: boolean;
  /** The webhook and the organization binding must both be set; one without the
   * other is a configuration error, not a reason to post. */
  misconfigured: boolean;
  reconciled: number;
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  released: number;
}

const MAX_CLAIM_ROUNDS = 8;

/** Drain the queue. Called inline after an attendance sync for immediacy, and
 * from the scheduled dispatch route for retries. */
export async function flushTimebotOutbox(limit = 20, fetchImpl: FetchLike = fetch): Promise<TimebotFlushSummary> {
  const summary: TimebotFlushSummary = {
    configured: false,
    misconfigured: false,
    reconciled: 0,
    claimed: 0,
    sent: 0,
    retried: 0,
    dead: 0,
    released: 0,
  };

  const url = timebotWebhookUrl();
  const organizationId = timebotOrganizationId();
  if (!url || !organizationId) {
    summary.misconfigured = Boolean(url) !== Boolean(organizationId);
    return summary;
  }
  summary.configured = true;

  const db = createAdminClient();
  const now = new Date();
  // A worker that died mid-send leaves a row claimed forever. Return it to the
  // retry pool rather than losing the event.
  const sweep = await db
    .from("work_notification_outbox")
    .update({ status: "failed", next_attempt_at: now.toISOString(), last_error: "send timed out" })
    .eq("status", "sending")
    .lt("attempted_at", new Date(now.getTime() - STALE_SENDING_MS).toISOString());
  if (sweep.error) throw new Error(`reset timebot outbox: ${sweep.error.message}`);

  // Re-create rows for session events whose enqueue the trigger swallowed,
  // bounded by the cutover. Recovery must never block delivery: a failed read or
  // call leaves already-queued rows draining, and is reported rather than hidden.
  try {
    const activatedAt = await readTimebotActivation(db, organizationId);
    if (activatedAt) {
      const reconciled = await db.rpc("work_reconcile_timebot_outbox", { p_since: activatedAt, p_limit: 50 });
      if (reconciled.error) {
        console.error("[work-os] timebot reconcile failed", { message: reconciled.error.message });
      } else {
        // `SELECT * FROM fn()` returns a row per function column, not a scalar.
        const row = (Array.isArray(reconciled.data) ? reconciled.data[0] : reconciled.data) as
          | { work_reconcile_timebot_outbox?: number | string }
          | null
          | undefined;
        const count = Number(row?.work_reconcile_timebot_outbox ?? 0);
        summary.reconciled = Number.isFinite(count) ? count : 0;
      }
    }
  } catch (error) {
    console.error("[work-os] timebot reconcile skipped", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  let blocked = false;
  // The predecessor rule makes at most one row per organization claimable at a
  // time, so one claim per run would drain a backlog at a single event per run.
  for (let round = 0; round < MAX_CLAIM_ROUNDS && !blocked; round += 1) {
    const claimed = await db.rpc("work_claim_notification_outbox", { p_limit: limit });
    if (claimed.error) throw new Error(`claim timebot outbox: ${claimed.error.message}`);
    const rows = (claimed.data ?? []) as OutboxRow[];
    if (!rows.length) break;
    summary.claimed += rows.length;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (blocked) {
        // Release rows we never attempted so the next run sees them as due.
        const rest = rows.slice(index).map((unused) => unused.id);
        const released = await db
          .from("work_notification_outbox")
          .update({ status: "pending", next_attempt_at: now.toISOString() })
          .in("id", rest);
        if (released.error) throw new Error(`release timebot outbox: ${released.error.message}`);
        summary.released += rest.length;
        break;
      }

      if (row.organization_id !== organizationId) {
        // Never post another organization's attendance into this channel.
        await settle(db, row.id, {
          status: "dead",
          last_error: "organization is not bound to this timebot destination",
          next_attempt_at: now.toISOString(),
        });
        summary.dead += 1;
        continue;
      }

      const message = renderTimebotMessage({
        displayName: row.person_name,
        eventType: row.event_type,
        observedAt: row.observed_at,
        timezone: row.timezone,
        fromState: row.from_state,
        previousObservedAt: row.previous_observed_at,
        // Lateness is measured when the line is actually about to be sent, so a
        // long retry loop is reported as late even though it was enqueued on time.
        now: new Date(),
      });

      if (!message) {
        await settle(db, row.id, { status: "dead", last_error: "unrenderable event", next_attempt_at: now.toISOString() });
        summary.dead += 1;
        continue;
      }

      const result = await postTimebotMessage(message, url, fetchImpl);
      const outcome = classifyTimebotDelivery(result.status);

      if (outcome === "sent") {
        await settle(db, row.id, { status: "sent", sent_at: new Date().toISOString(), last_error: null });
        summary.sent += 1;
        continue;
      }

      if (outcome === "dead") {
        await settle(db, row.id, {
          status: "dead",
          last_error: describeTimebotFailure(result.status, result.error),
          next_attempt_at: now.toISOString(),
        });
        summary.dead += 1;
        continue;
      }

      const attempts = Number(row.attempts) || 1;
      // A valid transition is never discarded for age or for running out of
      // attempts. Only a permanent rejection (4xx, unrenderable, wrong
      // organization) is dead; everything transient keeps retrying at six hours.
      await settle(db, row.id, {
        status: "failed",
        last_error: describeTimebotFailure(result.status, result.error),
        next_attempt_at: new Date(now.getTime() + timebotBackoffMs(attempts)).toISOString(),
      });
      summary.retried += 1;
      // Keep the channel in order: nothing later may overtake a failed event.
      blocked = true;
    }
  }

  return summary;
}

/** Never store or log the webhook URL: the UUID in it is the whole credential. */
export function describeTimebotFailure(status: number | null, error?: string) {
  if (status === null) return `network: ${redact(error ?? "request failed")}`;
  if (status === 404) return "integration missing or rotated (404)";
  if (status === 401 || status === 403) return `rejected (${status})`;
  return `http ${status}`;
}

function redact(value: string) {
  return value.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 200);
}
