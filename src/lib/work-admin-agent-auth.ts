import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { AppProfile } from "@/lib/supabase/auth";
import {
  WorkOsConflictError,
  WorkOsForbiddenError,
  WorkOsNotFoundError,
  WorkOsValidationError,
  type WorkOsAccess,
  type WorkOsOrgRole,
} from "@/lib/work-os-api";
import {
  ADMIN_AGENT_FEATURE_FLAG,
  hashAgentToken,
  type AdminAgentScope,
} from "@/lib/work-agent-tokens";
import { AgentRateLimitError } from "@/lib/work-agent-rate-limit";
import { db, isWorkOsMigrationRequired } from "@/lib/work-os-internal";
import { CompletionEvidenceError } from "@/modules/work-os/completion-evidence";

/** Admin tokens read across the organization instead of one person, so the
 * resolver authorizes by the admin's active membership rather than a person
 * mapping. The role is re-read on every request: a demoted admin loses access
 * on the next call, and the token row is never trusted with a role. */

const ADMIN_AGENT_LAST_USED_THROTTLE_MS = 60_000;
/** The admin surface reuses the companion readers, so both flags must be on. */
const COMPANION_FEATURE_FLAG = "employee_companion";

export type AdminAgentAccess = {
  access: WorkOsAccess;
  tokenId: string;
  tokenName: string;
  tokenPrefix: string;
  expiresAt: string | null;
  scopes: AdminAgentScope[];
};

export function parseAdminAgentAuthorization(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(wos_admin_[A-Za-z0-9_-]+)$/i);
  return match ? match[1] : null;
}

export function hasAdminAgentScope(scopes: AdminAgentScope[], required?: AdminAgentScope): boolean {
  return !required || scopes.includes(required);
}

export function adminAgentError(code: string, message: string, status: number) {
  return NextResponse.json({ error: message, code, request_id: randomUUID() }, { status });
}

function isNamed(error: unknown, name: string): error is Error {
  // Module identity can differ between an aliased import and a relative one;
  // the class name keeps the mapping stable across both.
  return error instanceof Error && error.name === name;
}

function isWorkOsConflict(error: unknown): error is WorkOsConflictError {
  return error instanceof WorkOsConflictError || isNamed(error, "WorkOsConflictError");
}

/** A record this token cannot see. Matched by type and class name so a
 * reworded message can never turn a 404 into a 500. */
function isWorkOsNotFound(error: unknown): error is Error {
  return error instanceof WorkOsNotFoundError || isNamed(error, "WorkOsNotFoundError");
}

function isCompletionEvidence(error: unknown): error is CompletionEvidenceError {
  return error instanceof CompletionEvidenceError || isNamed(error, "CompletionEvidenceError");
}

/** Task 10's preview store answers with its own code and status. Matching the
 * class name keeps this module from importing the preview store, which imports
 * the auth module for its access contract. */
function previewErrorResponse(error: unknown): NextResponse | null {
  if (!isNamed(error, "WorkAdminPreviewError")) return null;
  const { code, status } = error as Error & { code?: unknown; status?: unknown };
  const resolvedCode = typeof code === "string" && code ? code : "conflict";
  const resolvedStatus = typeof status === "number" && status >= 400 && status < 600 ? status : 409;
  return adminAgentError(resolvedCode, error.message, resolvedStatus);
}

/** One error mapper for every admin route: the same `{ error, code,
 * request_id }` contract as the employee surface. */
export function adminAgentRouteError(error: unknown): NextResponse {
  if (error instanceof AgentRateLimitError) {
    const response = adminAgentError("rate_limited", error.message, 429);
    response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  if (isWorkOsMigrationRequired(error)) {
    return adminAgentError("migration_required", "Work OS admin agent access is not installed yet", 503);
  }
  const preview = previewErrorResponse(error);
  if (preview) return preview;
  if (isWorkOsConflict(error)) {
    const response = adminAgentError(error.reason ?? "conflict", error.message, 409);
    if (error.reason === "idempotency_in_flight") response.headers.set("Retry-After", "1");
    return response;
  }
  if (isWorkOsNotFound(error)) return adminAgentError("not_found", error.message || "Not found", 404);
  if (error instanceof WorkOsForbiddenError || isNamed(error, "WorkOsForbiddenError")) {
    return adminAgentError("forbidden", "You do not have permission to change this record", 403);
  }
  if (isCompletionEvidence(error)) {
    if (error.code === "file_too_large") return adminAgentError("file_too_large", error.message, 413);
    if (error.code === "unsupported_file_type") return adminAgentError("unsupported_file_type", error.message, 415);
    return adminAgentError("validation_error", error.message, 400);
  }
  if (error instanceof WorkOsValidationError || isNamed(error, "WorkOsValidationError")) {
    return adminAgentError("validation_error", error.message, 400);
  }
  const message = error instanceof Error ? error.message : "Request failed";
  if (/not found|not available/i.test(message)) return adminAgentError("not_found", message, 404);
  if (/required|must be|characters or fewer|invalid/i.test(message)) {
    return adminAgentError("validation_error", message, 400);
  }
  console.error("[work-os] admin agent route failed", { message });
  return adminAgentError("internal_error", "Request failed", 500);
}

export async function requireAdminAgentAccess(
  req: Request,
  required?: AdminAgentScope,
): Promise<{ agent: AdminAgentAccess; response?: never } | { response: NextResponse; agent?: never }> {
  const secret = parseAdminAgentAuthorization(req.headers.get("authorization"));
  if (!secret) return { response: adminAgentError("unauthorized", "A valid admin agent token is required", 401) };

  const supabase = db();
  // The admin surface only resolves admin tokens. An employee token is simply
  // unknown here — 401, never a 403 that would name the other surface.
  const { data: token, error: tokenError } = await supabase.from("work_agent_tokens")
    .select("id,organization_id,person_id,user_id,name,token_prefix,scopes,expires_at,last_used_at,revoked_at")
    .eq("token_hash", hashAgentToken(secret))
    .eq("kind", "admin")
    .maybeSingle();
  if (tokenError) throw new Error(`load admin agent token: ${tokenError.message}`);
  if (!token) return { response: adminAgentError("unauthorized", "A valid admin agent token is required", 401) };
  if (token.revoked_at) return { response: adminAgentError("token_revoked", "This admin agent token was revoked", 401) };
  if (!token.expires_at || new Date(token.expires_at as string).getTime() <= Date.now()) {
    return { response: adminAgentError("token_expired", "This admin agent token has expired", 401) };
  }

  const [profileResult, membershipResult, organizationResult] = await Promise.all([
    supabase.from("profiles").select("id,email,display_name,avatar_url,role,created_at").eq("id", token.user_id as string).maybeSingle(),
    // Membership comes from organization + user + active, never person: an
    // unmapped admin is valid and its role is authoritative for this call.
    supabase.from("work_org_members").select("id,organization_id,user_id,role,active,feature_flags")
      .eq("organization_id", token.organization_id as string)
      .eq("user_id", token.user_id as string)
      .eq("active", true)
      .maybeSingle(),
    supabase.from("work_organizations").select("name,feature_flags,legacy_owner_id,created_by").eq("id", token.organization_id as string).maybeSingle(),
  ]);
  if (profileResult.error) throw new Error(`load admin agent profile: ${profileResult.error.message}`);
  if (membershipResult.error) throw new Error(`load admin agent membership: ${membershipResult.error.message}`);
  if (organizationResult.error) throw new Error(`load admin agent organization: ${organizationResult.error.message}`);
  const profile = profileResult.data as AppProfile | null;
  const membership = membershipResult.data as Record<string, unknown> | null;
  const organization = organizationResult.data as Record<string, unknown> | null;
  if (!profile || !membership || !organization) {
    return { response: adminAgentError("unauthorized", "This admin agent token is no longer valid", 401) };
  }

  const role = membership.role as WorkOsOrgRole;
  if (role !== "admin") {
    return { response: adminAgentError("forbidden", "Admin role required for the admin agent API", 403) };
  }

  const featureFlags = {
    ...((organization.feature_flags ?? {}) as Record<string, boolean>),
    ...((membership.feature_flags ?? {}) as Record<string, boolean>),
  };
  if (featureFlags[ADMIN_AGENT_FEATURE_FLAG] !== true) {
    return { response: adminAgentError("feature_disabled", "The admin agent API is not enabled for this organization", 403) };
  }
  if (featureFlags[COMPANION_FEATURE_FLAG] !== true) {
    return { response: adminAgentError("feature_disabled", "The employee companion is not enabled for this organization", 403) };
  }

  const scopes = ((token.scopes ?? []) as AdminAgentScope[]);
  if (!hasAdminAgentScope(scopes, required)) {
    return { response: adminAgentError("insufficient_scope", `This token is missing the ${required} scope`, 403) };
  }

  const lastUsedAt = token.last_used_at ? new Date(token.last_used_at as string).getTime() : 0;
  if (!lastUsedAt || Date.now() - lastUsedAt > ADMIN_AGENT_LAST_USED_THROTTLE_MS) {
    try {
      await supabase.from("work_agent_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", token.id as string);
    } catch {
      // Best effort: a missed touch never blocks an authorized request.
    }
  }

  const organizationId = token.organization_id as string;
  const organizationName = String(organization.name ?? "Workspace");
  const personId = (token.person_id as string | null) ?? null;
  const access: WorkOsAccess = {
    ctx: { user: { id: token.user_id as string }, profile },
    organizationId,
    organizationName,
    organizationOwnerId: ((organization.legacy_owner_id || organization.created_by) as string | null) ?? null,
    role: "admin",
    personId,
    membershipId: membership.id as string,
    featureFlags,
    workspaces: [{ organizationId, name: organizationName, role: "admin", personId }],
  };
  return {
    agent: {
      access,
      tokenId: token.id as string,
      tokenName: token.name as string,
      tokenPrefix: token.token_prefix as string,
      expiresAt: (token.expires_at as string | null) ?? null,
      scopes,
    },
  };
}
