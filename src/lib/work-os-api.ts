import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUserProfile, type AppProfile } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminDbRole } from "@/lib/userRoles";
import { isWorkOsMigrationRequired } from "@/lib/work-os";
import { pickMembership, type WorkOsMembershipCandidate } from "@/lib/work-os-membership";
import { checkInIntervalOption, firstFollowUpOption } from "@/modules/work-os/workday";

export type WorkOsOrgRole = "employee" | "manager" | "admin";

interface WorkOsRequestContext {
  user: { id: string };
  profile: AppProfile;
}

export interface WorkOsAccess {
  ctx: WorkOsRequestContext;
  organizationId: string;
  organizationOwnerId: string | null;
  role: WorkOsOrgRole;
  personId: string | null;
  membershipId: string;
  featureFlags: Record<string, boolean>;
  /** Cadence the installed app reports from its own local config file, so an
   * edit on one machine applies to that machine only. Validated against the
   * same bounds as every other cadence source; absent when unset or invalid. */
  localCadence?: {
    checkInIntervalMinutes?: number;
    firstFollowUpMinutes?: number;
  };
}

export class WorkOsConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkOsConflictError";
  }
}

/** Caller-fixable input (bounded fields, unsupported edits). `jsonError` maps
 * it to 400 so clients never retry or offline-queue a request that cannot
 * succeed on replay. */
export class WorkOsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkOsValidationError";
  }
}

type WorkOsAccessResult =
  | { access: WorkOsAccess; response?: never }
  | { response: NextResponse; access?: never };

function companionSchemaMissing(message: string) {
  return /work_(organizations|org_members)/i.test(message) &&
    (/does not exist/i.test(message) || /schema cache/i.test(message) || /Could not find/i.test(message));
}

async function ensureOwnerOrganization(ctx: WorkOsRequestContext) {
  const supabase = createAdminClient();
  const slug = `legacy-${ctx.profile.id.replaceAll("-", "")}`;
  const { data: organization, error: organizationError } = await supabase
    .from("work_organizations")
    .upsert({
      name: `${ctx.profile.displayName || ctx.profile.email || "Work OS"} Workspace`,
      slug,
      legacy_owner_id: ctx.profile.id,
      created_by: ctx.profile.id,
    }, { onConflict: "legacy_owner_id" })
    .select("id")
    .single();
  if (organizationError) throw new Error(`create Work OS organization: ${organizationError.message}`);

  const { data: membership, error: membershipError } = await supabase
    .from("work_org_members")
    .upsert({
      organization_id: organization.id,
      user_id: ctx.profile.id,
      role: "admin",
      active: true,
    }, { onConflict: "organization_id,user_id" })
    .select("id, organization_id, role, person_id, feature_flags")
    .single();
  if (membershipError) throw new Error(`create Work OS membership: ${membershipError.message}`);
  return membership;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const DESKTOP_LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

async function resolveDesktopContext(authorization: string) {
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  const supabase = createAdminClient();
  const { data: session, error: sessionError } = await supabase
    .from("work_desktop_sessions")
    .select("id, organization_id, user_id, expires_at, revoked_at, last_used_at")
    .eq("token_hash", tokenHash(match[1]))
    .maybeSingle();
  if (sessionError) throw new Error(`load Work OS desktop session: ${sessionError.message}`);
  if (!session || session.revoked_at || new Date(session.expires_at as string).getTime() <= Date.now()) return null;

  const { data: row, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_url, role, created_at")
    .eq("id", session.user_id)
    .maybeSingle();
  if (profileError) throw new Error(`load Work OS desktop profile: ${profileError.message}`);
  if (!row) return null;
  const lastUsedAt = session.last_used_at as string | null;
  if (!lastUsedAt || Date.now() - new Date(lastUsedAt).getTime() > DESKTOP_LAST_USED_THROTTLE_MS) {
    await supabase.from("work_desktop_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", session.id);
  }
  return {
    ctx: {
      user: { id: row.id as string },
      profile: {
        id: row.id as string,
        email: row.email as string | null,
        displayName: row.display_name as string | null,
        avatarUrl: row.avatar_url as string | null,
        role: row.role as AppProfile["role"],
        createdAt: row.created_at as string,
      },
    } satisfies WorkOsRequestContext,
    organizationId: session.organization_id as string,
  };
}

async function loadMembership(userId: string, organizationId?: string | null) {
  let query = createAdminClient()
    .from("work_org_members")
    .select("id, organization_id, role, person_id, feature_flags, created_at")
    .eq("user_id", userId)
    .eq("active", true);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) {
    if (companionSchemaMissing(error.message)) {
      throw new Error("Work OS Employee Companion migration required: apply supabase/migrations/0010_work_os_employee_companion.sql.");
    }
    throw new Error(`load Work OS membership: ${error.message}`);
  }
  // Memberships created by one statement share created_at, so ordering on the
  // server alone left the chosen organization to row order. Rank here instead.
  return pickMembership((data ?? []) as WorkOsMembershipCandidate[]);
}

export async function requireWorkOsAccess(options: {
  roles?: WorkOsOrgRole[];
  organizationId?: string | null;
  requirePerson?: boolean;
  authorization?: string | null;
  feature?: string;
  /** Raw `x-work-os-cadence-minutes` header from the installed app. */
  cadenceMinutes?: string | null;
  /** Raw `x-work-os-first-follow-up-minutes` header from the installed app. */
  firstFollowUpMinutes?: string | null;
} = {}): Promise<WorkOsAccessResult> {
  // A machine-local override only counts when it is a valid, in-bounds cadence:
  // a bad local edit must never storm or silence a workday. An absent or
  // rejected value simply leaves the deployment's own resolution in charge.
  const localCheckIn = checkInIntervalOption(options.cadenceMinutes);
  const localFirstFollowUp = firstFollowUpOption(options.firstFollowUpMinutes);
  const localCadence = localCheckIn !== null || localFirstFollowUp !== null
    ? {
        ...(localCheckIn !== null ? { checkInIntervalMinutes: localCheckIn } : {}),
        ...(localFirstFollowUp !== null ? { firstFollowUpMinutes: localFirstFollowUp } : {}),
      }
    : undefined;
  const desktop = options.authorization ? await resolveDesktopContext(options.authorization) : null;
  if (options.authorization && !desktop) {
    return { response: NextResponse.json({ error: "invalid or expired desktop session" }, { status: 401 }) };
  }
  // API routes must never leak Next.js redirect exceptions (thrown by
  // requireUserProfile when no session cookie exists) as 500s. A missing
  // session is a 401 for API clients; page navigation still redirects via
  // requireUserProfile in Server Components.
  let ctx: WorkOsRequestContext;
  try {
    ctx = desktop ? desktop.ctx : await requireUserProfile();
  } catch (err) {
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return { response: NextResponse.json({ error: "authentication required" }, { status: 401 }) };
    }
    throw err;
  }
  const requestedOrganizationId = desktop?.organizationId ?? options.organizationId;
  if (desktop && options.organizationId && options.organizationId !== desktop.organizationId) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  let membership = await loadMembership(ctx.profile.id, requestedOrganizationId);
  if (!membership && isAdminDbRole(ctx.profile.role) && !options.organizationId) {
    membership = await ensureOwnerOrganization(ctx);
  }
  if (!membership) {
    return { response: NextResponse.json({ error: "Work OS organization membership required." }, { status: 403 }) };
  }
  const role = membership.role as WorkOsOrgRole;
  const { data: organization, error: organizationError } = await createAdminClient()
    .from("work_organizations")
    .select("feature_flags, legacy_owner_id, created_by")
    .eq("id", membership.organization_id)
    .single();
  if (organizationError) throw new Error(`load Work OS feature flags: ${organizationError.message}`);
  const featureFlags = {
    ...((organization.feature_flags ?? {}) as Record<string, boolean>),
    ...((membership.feature_flags ?? {}) as Record<string, boolean>),
  };
  if (options.feature && featureFlags[options.feature] !== true) {
    return { response: NextResponse.json({ error: "Work OS feature is not enabled for this organization or employee." }, { status: 403 }) };
  }
  if (options.roles && !options.roles.includes(role)) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  if (options.requirePerson && !membership.person_id) {
    return { response: NextResponse.json({ error: "Work OS person mapping required." }, { status: 409 }) };
  }
  return {
    access: {
      ctx,
      organizationId: membership.organization_id as string,
      organizationOwnerId: ((organization.legacy_owner_id || organization.created_by) as string | null) ?? null,
      role,
      personId: membership.person_id as string | null,
      membershipId: membership.id as string,
      featureFlags,
      ...(localCadence ? { localCadence } : {}),
    } satisfies WorkOsAccess,
  };
}

export function workOsOrganizationOwnerId(access: WorkOsAccess): string {
  if (!access.organizationOwnerId) throw new Error("Work OS organization has no owner");
  return access.organizationOwnerId;
}

export async function accessibleWorkOsPersonIds(access: WorkOsAccess): Promise<string[] | null> {
  if (access.role === "admin") return null;
  if (access.role === "employee") return access.personId ? [access.personId] : [];
  if (!access.personId) return [];
  const supabase = createAdminClient();
  const { data: managedTeams, error: managerError } = await supabase
    .from("work_team_members")
    .select("team_id")
    .eq("person_id", access.personId)
    .eq("is_manager", true);
  if (managerError) throw new Error(`load managed Work OS teams: ${managerError.message}`);
  const teamIds = (managedTeams ?? []).map((row: any) => row.team_id as string);
  if (!teamIds.length) return [access.personId];
  const { data: members, error: targetError } = await supabase
    .from("work_team_members")
    .select("person_id")
    .in("team_id", teamIds);
  if (targetError) throw new Error(`check Work OS team access: ${targetError.message}`);
  return [...new Set([access.personId, ...(members ?? []).map((row: any) => row.person_id as string)])];
}

export async function canAccessWorkOsPerson(access: WorkOsAccess, personId: string) {
  const ids = await accessibleWorkOsPersonIds(access);
  return ids === null || ids.includes(personId);
}

export async function requireWorkOsPersonAccess(access: WorkOsAccess, personId: string) {
  if (await canAccessWorkOsPerson(access, personId)) return null;
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function requireWorkOsAdmin(organizationId?: string | null, authorization?: string | null): Promise<
  | { ctx: WorkOsAccess["ctx"]; access: WorkOsAccess; response?: never }
  | { response: NextResponse; ctx?: never; access?: never }
> {
  // Honor the caller's selected organization. Without it, loadMembership picks
  // the user's oldest membership, which silently writes to the wrong tenant
  // for anyone who belongs to more than one organization. A desktop bearer
  // token authorizes the same membership as a browser cookie.
  const result = await requireWorkOsAccess({ roles: ["admin"], organizationId: organizationId ?? null, authorization: authorization ?? null });
  if (result.response) return { response: result.response };
  return { ctx: result.access.ctx, access: result.access };
}

export function jsonError(err: unknown, status?: number) {
  if (isWorkOsMigrationRequired(err)) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Work OS database migration required.",
      migration: "supabase/migrations/0011_work_os_employee_onboarding.sql",
    }, { status: 503 });
  }
  if (err instanceof WorkOsConflictError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof WorkOsValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : "Request failed";
  if (message.includes("Employee Companion migration required")) {
    return NextResponse.json({
      error: message,
      migration: "supabase/migrations/0010_work_os_employee_companion.sql",
    }, { status: 503 });
  }
  const code = status ?? (message.includes("required") || message.includes("not found") || message.includes("must be") ? 400 : 500);
  return NextResponse.json({ error: message }, { status: code });
}
