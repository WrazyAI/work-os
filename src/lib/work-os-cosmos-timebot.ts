import { createAdminClient } from "@/lib/supabase/admin";

/** The four employee-facing milestones worth posting. Everything else in
 * work_session_events (`late_reason`, `mark_active`, `worktivity_reopened`,
 * `resolve_missed_clock_out`, ...) is a system or correction event and would
 * just add noise to a human punch-clock channel. */
export const COSMOS_TIMEBOT_EVENTS = ["clock_in", "pause", "resume", "clock_out"] as const;
export type CosmosTimebotEvent = (typeof COSMOS_TIMEBOT_EVENTS)[number];

/** Channel vocabulary. `pause`/`resume` are Work OS's names for a break; the
 * team writes `break` and `back`. */
const EVENT_WORD: Record<CosmosTimebotEvent, string> = {
  clock_in: "in",
  pause: "break",
  resume: "back",
  clock_out: "out",
};

export type CosmosDeliveryOutcome = "sent" | "retry" | "dead";

const REQUEST_TIMEOUT_MS = 5_000;
const STALE_SENDING_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 8;

/** 1m, 5m, 15m, 1h, 6h — then hold at 6h until MAX_ATTEMPTS. */
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

/** `17:06` in the employee's own timezone. The channel timestamp is the
 * reader's clock, which is wrong for anyone outside that zone; and because
 * Cosmos groups consecutive posts under one timestamp, each line has to carry
 * its own time or the events become unreadable. */
export function formatTimebotTime(observedAt: string, timezone: string | null) {
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return "--:--";
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone || "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date);
  }
}

/** Cosmos shows the integration's name as the author, so the employee's name
 * has to live in the body. First name only: the channel is read at a glance and
 * the team uses first names. */
export function renderTimebotMessage(input: {
  displayName: string;
  eventType: string;
  observedAt: string;
  timezone?: string | null;
}): string | null {
  if (!(COSMOS_TIMEBOT_EVENTS as readonly string[]).includes(input.eventType)) return null;
  const word = EVENT_WORD[input.eventType as CosmosTimebotEvent];
  const name = input.displayName.trim().split(/\s+/)[0];
  if (!name) return null;
  return `${formatTimebotTime(input.observedAt, input.timezone ?? null)} ${name} — ${word}`;
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
  await db
    .from("work_notification_outbox")
    .update({ status: "failed", next_attempt_at: now.toISOString(), last_error: "send timed out" })
    .eq("status", "sending")
    .lt("attempted_at", new Date(now.getTime() - STALE_SENDING_MS).toISOString());

  // Re-create rows for session events whose enqueue the trigger swallowed. A
  // recovery error must not stop the drain that already has work to do.
  const reconciled = await db.rpc("work_reconcile_timebot_outbox", { p_limit: 50 });
  if (!reconciled.error) summary.reconciled = Number(reconciled.data) || 0;

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
        await db
          .from("work_notification_outbox")
          .update({ status: "pending", next_attempt_at: now.toISOString() })
          .in("id", rest);
        summary.released += rest.length;
        break;
      }

      if (row.organization_id !== organizationId) {
        // Never post another organization's attendance into this channel.
        await db
          .from("work_notification_outbox")
          .update({
            status: "dead",
            last_error: "organization is not bound to this timebot destination",
            next_attempt_at: now.toISOString(),
          })
          .eq("id", row.id);
        summary.dead += 1;
        continue;
      }

      const message = renderTimebotMessage({
        displayName: row.person_name,
        eventType: row.event_type,
        observedAt: row.observed_at,
        timezone: row.timezone,
      });

      if (!message) {
        await db
          .from("work_notification_outbox")
          .update({ status: "dead", last_error: "unrenderable event", next_attempt_at: now.toISOString() })
          .eq("id", row.id);
        summary.dead += 1;
        continue;
      }

      const result = await postTimebotMessage(message, url, fetchImpl);
      const outcome = classifyTimebotDelivery(result.status);

      if (outcome === "sent") {
        await db
          .from("work_notification_outbox")
          .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
          .eq("id", row.id);
        summary.sent += 1;
        continue;
      }

      if (outcome === "dead") {
        await db
          .from("work_notification_outbox")
          .update({
            status: "dead",
            last_error: describeFailure(result.status, result.error),
            next_attempt_at: now.toISOString(),
          })
          .eq("id", row.id);
        summary.dead += 1;
        continue;
      }

      const attempts = Number(row.attempts) || 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db
          .from("work_notification_outbox")
          .update({
            status: "dead",
            last_error: `gave up after ${attempts} attempts: ${describeFailure(result.status, result.error)}`,
            next_attempt_at: now.toISOString(),
          })
          .eq("id", row.id);
        summary.dead += 1;
        continue;
      }

      await db
        .from("work_notification_outbox")
        .update({
          status: "failed",
          last_error: describeFailure(result.status, result.error),
          next_attempt_at: new Date(now.getTime() + timebotBackoffMs(attempts)).toISOString(),
        })
        .eq("id", row.id);
      summary.retried += 1;
      // Keep the channel in order: nothing later may overtake a failed event.
      blocked = true;
    }
  }

  return summary;
}

/** Never store or log the webhook URL: the UUID in it is the whole credential. */
function describeFailure(status: number | null, error?: string) {
  if (status === null) return `network: ${redact(error ?? "request failed")}`;
  if (status === 404) return "integration missing or rotated (404)";
  if (status === 401 || status === 403) return `rejected (${status})`;
  return `http ${status}`;
}

function redact(value: string) {
  return value.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 200);
}
