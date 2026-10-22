import { createHash } from "node:crypto";
import { WorkOsConflictError, WorkOsValidationError } from "@/lib/work-os-api";
import { db, type Json } from "@/lib/work-os-internal";
import type { AgentAccess } from "@/lib/work-agent-auth";

/** The response cache behind `Idempotency-Key`. The data client has no
 * multi-statement transaction, so retry safety comes from this cache plus the
 * operation-level unique keys (task agent key, evidence key, day-event key). */

export const AGENT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
export const AGENT_IDEMPOTENCY_STALE_MS = 60_000;
export const AGENT_IDEMPOTENCY_KEY_MAX = 160;

export type AgentIdempotencyRow = {
  request_hash: string;
  status: number | null;
  body: unknown;
  updated_at: string;
};

export type AgentIdempotencyDecision =
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" }
  | { kind: "in_flight" }
  | { kind: "claim" };

export function idempotencyDecision(row: AgentIdempotencyRow | null, requestHash: string, now: Date): AgentIdempotencyDecision {
  if (!row) return { kind: "claim" };
  const inFlight = row.status === null || row.status === 0;
  if (inFlight && row.request_hash !== requestHash) return { kind: "conflict" };
  if (inFlight) {
    const stale = now.getTime() - new Date(row.updated_at).getTime() > AGENT_IDEMPOTENCY_STALE_MS;
    return stale ? { kind: "claim" } : { kind: "in_flight" };
  }
  if (row.request_hash !== requestHash) return { kind: "conflict" };
  return { kind: "replay", status: row.status as number, body: row.body };
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export function agentRequestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()}\n${path}\n${canonical(body)}`).digest("hex");
}

export type AgentIdempotencyResult = { status: number; body: unknown; replayed: boolean };

/** 5xx responses are transient: caching them would trap a same-key retry on a
 * stale failure, while every mutation is already idempotent by its own key. */
export function cacheAgentResponse(status: number): boolean {
  return status < 500;
}

export async function withAgentIdempotency(input: {
  agent: AgentAccess;
  key: string | null | undefined;
  requestHash: string;
  handler: () => Promise<{ status: number; body: unknown }>;
}): Promise<AgentIdempotencyResult> {
  const key = (input.key ?? "").trim();
  if (!key) throw new WorkOsValidationError("Idempotency-Key is required");
  if (key.length > AGENT_IDEMPOTENCY_KEY_MAX) {
    throw new WorkOsValidationError(`Idempotency-Key must be ${AGENT_IDEMPOTENCY_KEY_MAX} characters or fewer`);
  }
  const { agent, requestHash } = input;
  const now = new Date();
  const read = async (): Promise<AgentIdempotencyRow | null> => {
    const { data, error } = await db().from("work_agent_idempotency")
      .select("request_hash,status,body,updated_at")
      .eq("token_id", agent.tokenId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error(`load agent idempotency: ${error.message}`);
    return (data ?? null) as AgentIdempotencyRow | null;
  };
  const settle = (decision: AgentIdempotencyDecision): AgentIdempotencyResult => {
    if (decision.kind === "replay") return { status: decision.status, body: decision.body, replayed: true };
    if (decision.kind === "conflict") {
      throw new WorkOsConflictError("Idempotency-Key was already used with a different request", "idempotency_conflict");
    }
    throw new WorkOsConflictError("The same request is still being applied; retry shortly", "idempotency_in_flight");
  };

  const existing = await read();
  const decision = idempotencyDecision(existing, requestHash, now);
  if (decision.kind !== "claim") return settle(decision);

  const expiresAt = new Date(now.getTime() + AGENT_IDEMPOTENCY_TTL_MS).toISOString();
  if (existing) {
    const { error } = await db().from("work_agent_idempotency")
      .update({ request_hash: requestHash, status: 0, body: null, updated_at: now.toISOString(), expires_at: expiresAt })
      .eq("token_id", agent.tokenId)
      .eq("key", key);
    if (error) throw new Error(`claim stale agent idempotency: ${error.message}`);
  } else {
    const { error } = await db().from("work_agent_idempotency").insert({
      organization_id: agent.access.organizationId,
      token_id: agent.tokenId,
      key,
      request_hash: requestHash,
      status: 0,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    });
    if (error) {
      const raced = await read();
      const racedDecision = idempotencyDecision(raced, requestHash, new Date());
      if (racedDecision.kind === "claim") throw new Error(`claim agent idempotency: ${error.message}`);
      return settle(racedDecision);
    }
  }

  let result: { status: number; body: unknown };
  try {
    result = await input.handler();
  } catch (error) {
    // Release the claim so a corrected retry can run; the mutation itself is
    // idempotent through its own unique key.
    await db().from("work_agent_idempotency").delete().eq("token_id", agent.tokenId).eq("key", key);
    throw error;
  }
  if (!cacheAgentResponse(result.status)) {
    await db().from("work_agent_idempotency").delete().eq("token_id", agent.tokenId).eq("key", key);
    return { status: result.status, body: result.body, replayed: false };
  }
  const { error: storeError } = await db().from("work_agent_idempotency")
    .update({ status: result.status, body: result.body as Json, updated_at: new Date().toISOString() })
    .eq("token_id", agent.tokenId)
    .eq("key", key);
  if (storeError) console.error("[work-os] store agent idempotency response failed", { message: storeError.message });
  return { status: result.status, body: result.body, replayed: false };
}
