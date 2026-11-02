import { createHash, randomBytes } from "node:crypto";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { WorkOsForbiddenError, WorkOsValidationError } from "@/lib/work-os-api";
import { audit, db, type Json } from "@/lib/work-os-internal";

/** Scoped, self-minted credentials for external agents. A token is bound to
 * one organization, one person, and one user; the raw secret is shown once and
 * only its SHA-256 hex digest is stored. */

export const AGENT_TOKEN_PREFIX = "wos_agent_";
export const AGENT_TOKEN_SCOPES = ["tasks:read", "tasks:write", "progress:write", "evidence:write"] as const;
export type AgentScope = (typeof AGENT_TOKEN_SCOPES)[number];
export const AGENT_TOKEN_DEFAULT_SCOPES: AgentScope[] = ["tasks:read", "tasks:write", "progress:write"];
export const AGENT_TOKEN_DEFAULT_EXPIRY_DAYS = 90;
export const AGENT_TOKEN_MAX_EXPIRY_DAYS = 365;
export const AGENT_TOKEN_NAME_MAX = 80;

const AGENT_TOKEN_COLUMNS = "id,name,token_prefix,scopes,created_at,last_used_at,expires_at,revoked_at";

export function newAgentTokenSecret(): string {
  return `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashAgentToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function agentTokenPrefix(secret: string): string {
  return secret.slice(0, 12);
}

export function validateAgentScopes(value: unknown): AgentScope[] {
  if (value === undefined || value === null) return [...AGENT_TOKEN_DEFAULT_SCOPES];
  if (!Array.isArray(value)) throw new WorkOsValidationError("Scopes must be an array of known scopes");
  const unique = [...new Set(value)];
  if (!unique.length) throw new WorkOsValidationError("At least one scope is required");
  for (const scope of unique) {
    if (!(AGENT_TOKEN_SCOPES as readonly string[]).includes(scope as string)) {
      throw new WorkOsValidationError(`Unknown scope: ${String(scope)}`);
    }
  }
  return unique as AgentScope[];
}

export function agentTokenExpiry(days?: unknown, now = new Date()): Date {
  const parsed = days === undefined || days === null ? AGENT_TOKEN_DEFAULT_EXPIRY_DAYS : Number(days);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > AGENT_TOKEN_MAX_EXPIRY_DAYS) {
    throw new WorkOsValidationError(`Token expiry must be between 1 and ${AGENT_TOKEN_MAX_EXPIRY_DAYS} days`);
  }
  return new Date(now.getTime() + parsed * 86_400_000);
}

export type AgentTokenInput = {
  name: unknown;
  scopes?: unknown;
  expiresInDays?: unknown;
};

export async function createAgentToken(access: WorkOsAccess, input: AgentTokenInput) {
  if (!access.personId) throw new WorkOsValidationError("Work OS person mapping required");
  const name = (typeof input.name === "string" ? input.name : "").trim();
  if (!name || name.length > AGENT_TOKEN_NAME_MAX) {
    throw new WorkOsValidationError(`Token name must be 1 to ${AGENT_TOKEN_NAME_MAX} characters`);
  }
  const scopes = validateAgentScopes(input.scopes);
  const expiresAt = agentTokenExpiry(input.expiresInDays);
  const secret = newAgentTokenSecret();
  const { data, error } = await db().from("work_agent_tokens").insert({
    organization_id: access.organizationId,
    person_id: access.personId,
    user_id: access.ctx.user.id,
    name,
    token_hash: hashAgentToken(secret),
    token_prefix: agentTokenPrefix(secret),
    scopes,
    created_by: access.ctx.user.id,
    expires_at: expiresAt.toISOString(),
  }).select(AGENT_TOKEN_COLUMNS).single();
  if (error) throw new Error(`create agent token: ${error.message}`);
  await audit(access, "agent_token.created", "agent_token", String((data as Json).id), {
    name,
    scopes,
    expiresAt: expiresAt.toISOString(),
  });
  return { token: data as Json, secret };
}

export async function listAgentTokens(access: WorkOsAccess) {
  if (!access.personId) throw new WorkOsValidationError("Work OS person mapping required");
  const { data, error } = await db().from("work_agent_tokens")
    .select(AGENT_TOKEN_COLUMNS)
    .eq("organization_id", access.organizationId)
    .eq("user_id", access.ctx.user.id)
    .eq("person_id", access.personId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`list agent tokens: ${error.message}`);
  return (data ?? []) as Json[];
}

export async function revokeAgentToken(access: WorkOsAccess, tokenId: string): Promise<boolean> {
  if (!access.personId) throw new WorkOsValidationError("Work OS person mapping required");
  const { data, error } = await db().from("work_agent_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("organization_id", access.organizationId)
    .eq("user_id", access.ctx.user.id)
    .eq("person_id", access.personId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`revoke agent token: ${error.message}`);
  if (!data) return false;
  await audit(access, "agent_token.revoked", "agent_token", String((data as Json).id), {});
  return true;
}

/** Admin-scoped agent tokens read across the organization instead of one
 * person, so they are bound to the admin user who minted them and carry an
 * explicit, minimal scope set. Reads are the default; every write is opt-in. */

export const ADMIN_AGENT_TOKEN_PREFIX = "wos_admin_";
export const ADMIN_AGENT_TOKEN_SCOPES = [
  "people:read", "tasks:read", "tasks:write", "eods:read",
  "eods:review", "records:read", "insights:read",
] as const;
export type AdminAgentScope = (typeof ADMIN_AGENT_TOKEN_SCOPES)[number];
export const ADMIN_AGENT_DEFAULT_SCOPES: AdminAgentScope[] = [
  "people:read", "tasks:read", "eods:read", "records:read", "insights:read",
];
export const ADMIN_AGENT_FEATURE_FLAG = "admin_agent_api";

export function newAdminAgentTokenSecret(): string {
  return `${ADMIN_AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function validateAdminAgentScopes(value: unknown): AdminAgentScope[] {
  if (value === undefined || value === null) return [...ADMIN_AGENT_DEFAULT_SCOPES];
  if (!Array.isArray(value)) throw new WorkOsValidationError("Scopes must be an array of known admin scopes");
  const unique = [...new Set(value)];
  if (!unique.length) throw new WorkOsValidationError("At least one admin scope is required");
  for (const scope of unique) {
    if (!(ADMIN_AGENT_TOKEN_SCOPES as readonly string[]).includes(scope as string)) {
      throw new WorkOsValidationError(`Unknown admin scope: ${String(scope)}`);
    }
  }
  return unique as AdminAgentScope[];
}

/** Mints admin tokens only for an admin in an organization where the admin
 * agent API is enabled; the route layer also guards this, and the model keeps
 * its own boundary so a caller cannot mint a cross-organization token. */
function requireAdminAgentTokenAccess(access: WorkOsAccess) {
  if (access.role !== "admin") {
    throw new WorkOsForbiddenError("Admin role required to manage admin agent tokens");
  }
  if (access.featureFlags?.[ADMIN_AGENT_FEATURE_FLAG] !== true) {
    throw new WorkOsForbiddenError("The admin agent API is not enabled for this organization");
  }
}

const ADMIN_AGENT_TOKEN_COLUMNS = `kind,${AGENT_TOKEN_COLUMNS}`;

export async function createAdminAgentToken(
  access: WorkOsAccess,
  input: { name: unknown; scopes?: unknown; expiresInDays?: unknown },
): Promise<{ token: Json; secret: string }> {
  requireAdminAgentTokenAccess(access);
  const name = (typeof input.name === "string" ? input.name : "").trim();
  if (!name || name.length > AGENT_TOKEN_NAME_MAX) {
    throw new WorkOsValidationError(`Token name must be 1 to ${AGENT_TOKEN_NAME_MAX} characters`);
  }
  const scopes = validateAdminAgentScopes(input.scopes);
  const expiresAt = agentTokenExpiry(input.expiresInDays);
  const secret = newAdminAgentTokenSecret();
  const { data, error } = await db().from("work_agent_tokens").insert({
    organization_id: access.organizationId,
    person_id: access.personId,
    user_id: access.ctx.user.id,
    kind: "admin",
    name,
    token_hash: hashAgentToken(secret),
    token_prefix: agentTokenPrefix(secret),
    scopes,
    created_by: access.ctx.user.id,
    expires_at: expiresAt.toISOString(),
  }).select(ADMIN_AGENT_TOKEN_COLUMNS).single();
  if (error) throw new Error(`create admin agent token: ${error.message}`);
  await audit(access, "agent_token.created", "agent_token", String((data as Json).id), {
    kind: "admin",
    name,
    scopes,
    expiresAt: expiresAt.toISOString(),
  });
  return { token: data as Json, secret };
}

export async function listAdminAgentTokens(access: WorkOsAccess): Promise<Json[]> {
  requireAdminAgentTokenAccess(access);
  const { data, error } = await db().from("work_agent_tokens")
    .select(ADMIN_AGENT_TOKEN_COLUMNS)
    .eq("organization_id", access.organizationId)
    .eq("user_id", access.ctx.user.id)
    .eq("kind", "admin")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`list admin agent tokens: ${error.message}`);
  return (data ?? []) as Json[];
}

export async function revokeAdminAgentToken(access: WorkOsAccess, tokenId: string): Promise<boolean> {
  requireAdminAgentTokenAccess(access);
  const { data, error } = await db().from("work_agent_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .eq("organization_id", access.organizationId)
    .eq("user_id", access.ctx.user.id)
    .eq("kind", "admin")
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`revoke admin agent token: ${error.message}`);
  if (!data) return false;
  await audit(access, "agent_token.revoked", "agent_token", String((data as Json).id), { kind: "admin" });
  return true;
}
