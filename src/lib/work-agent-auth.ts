import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { AppProfile } from "@/lib/supabase/auth";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess, type WorkOsOrgRole } from "@/lib/work-os-api";
import { hashAgentToken, type AgentScope } from "@/lib/work-agent-tokens";
import { db, isWorkOsMigrationRequired } from "@/lib/work-os-internal";
import { CompletionEvidenceError } from "@/modules/work-os/completion-evidence";

/** The v1 agent surface authenticates with a self-minted bearer token, then
 * resolves the token to the same WorkOsAccess the employee API uses so every
 * person-scoped service keeps its existing authorization. */

export type AgentActor = { tokenId: string; tokenName: string };

export type AgentAccess = {
  access: WorkOsAccess;
  tokenId: string;
  tokenName: string;
  tokenPrefix: string;
  expiresAt: string | null;
  scopes: AgentScope[];
};

const AGENT_LAST_USED_THROTTLE_MS = 60_000;

export function parseAgentAuthorization(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(wos_agent_[A-Za-z0-9_-]+)$/i);
  return match ? match[1] : null;
}

export function hasAgentScope(scopes: AgentScope[], required?: AgentScope): boolean {
  return !required || scopes.includes(required);
}

export function agentError(code: string, message: string, status: number) {
  return NextResponse.json({ error: message, code, request_id: randomUUID() }, { status });
}

/** One error mapper for every v1 route: the design's `{ error, code,
 * request_id }` contract, with cross-person lookups collapsing to 404. */
export function agentRouteError(error: unknown) {
  if (isWorkOsMigrationRequired(error)) {
    return agentError("migration_required", "Work OS agent access is not installed yet", 503);
  }
  if (error instanceof WorkOsConflictError) {
    return agentError(error.reason ?? "conflict", error.message, 409);
  }
  if (error instanceof WorkOsValidationError || error instanceof CompletionEvidenceError) {
    return agentError("validation_error", error.message, 400);
  }
  const message = error instanceof Error ? error.message : "Request failed";
  if (/not found/i.test(message)) return agentError("not_found", "Task not found", 404);
  if (/required|must be|characters or fewer|invalid/i.test(message)) {
    return agentError("validation_error", message, 400);
  }
  console.error("[work-os] agent route failed", { message });
  return agentError("internal_error", "Request failed", 500);
}

export async function requireAgentAccess(
  req: Request,
  required?: AgentScope,
): Promise<{ agent: AgentAccess; response?: never } | { response: NextResponse; agent?: never }> {
  const secret = parseAgentAuthorization(req.headers.get("authorization"));
  if (!secret) return { response: agentError("unauthorized", "A valid agent token is required", 401) };

  const supabase = db();
  const { data: token, error: tokenError } = await supabase.from("work_agent_tokens")
    .select("id,organization_id,person_id,user_id,name,token_prefix,scopes,expires_at,last_used_at,revoked_at")
    .eq("token_hash", hashAgentToken(secret))
    .maybeSingle();
  if (tokenError) throw new Error(`load agent token: ${tokenError.message}`);
  if (!token) return { response: agentError("unauthorized", "A valid agent token is required", 401) };
  if (token.revoked_at) return { response: agentError("token_revoked", "This agent token was revoked", 401) };
  if (!token.expires_at || new Date(token.expires_at as string).getTime() <= Date.now()) {
    return { response: agentError("token_expired", "This agent token has expired", 401) };
  }

  const [profileResult, membershipResult, organizationResult] = await Promise.all([
    supabase.from("profiles").select("id,email,display_name,avatar_url,role,created_at").eq("id", token.user_id as string).maybeSingle(),
    supabase.from("work_org_members").select("id,organization_id,user_id,person_id,role,active,feature_flags")
      .eq("organization_id", token.organization_id as string)
      .eq("user_id", token.user_id as string)
      .eq("person_id", token.person_id as string)
      .eq("active", true)
      .maybeSingle(),
    supabase.from("work_organizations").select("feature_flags,legacy_owner_id,created_by").eq("id", token.organization_id as string).maybeSingle(),
  ]);
  if (profileResult.error) throw new Error(`load agent profile: ${profileResult.error.message}`);
  if (membershipResult.error) throw new Error(`load agent membership: ${membershipResult.error.message}`);
  if (organizationResult.error) throw new Error(`load agent organization: ${organizationResult.error.message}`);
  const profile = profileResult.data as AppProfile | null;
  const membership = membershipResult.data as Record<string, unknown> | null;
  const organization = organizationResult.data as Record<string, unknown> | null;
  if (!profile || !membership || !organization) {
    return { response: agentError("unauthorized", "This agent token is no longer valid", 401) };
  }

  const featureFlags = {
    ...((organization.feature_flags ?? {}) as Record<string, boolean>),
    ...((membership.feature_flags ?? {}) as Record<string, boolean>),
  };
  if (featureFlags.employee_companion !== true) {
    return { response: agentError("feature_disabled", "The employee companion is not enabled for this organization", 403) };
  }

  const scopes = ((token.scopes ?? []) as AgentScope[]);
  if (!hasAgentScope(scopes, required)) {
    return { response: agentError("insufficient_scope", `This token is missing the ${required} scope`, 403) };
  }

  const lastUsedAt = token.last_used_at ? new Date(token.last_used_at as string).getTime() : 0;
  if (!lastUsedAt || Date.now() - lastUsedAt > AGENT_LAST_USED_THROTTLE_MS) {
    try {
      await supabase.from("work_agent_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", token.id as string);
    } catch {
      // Best effort: a missed touch never blocks an authorized request.
    }
  }

  const access: WorkOsAccess = {
    ctx: { user: { id: token.user_id as string }, profile },
    organizationId: token.organization_id as string,
    organizationOwnerId: ((organization.legacy_owner_id || organization.created_by) as string | null) ?? null,
    role: membership.role as WorkOsOrgRole,
    personId: token.person_id as string,
    membershipId: membership.id as string,
    featureFlags,
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
