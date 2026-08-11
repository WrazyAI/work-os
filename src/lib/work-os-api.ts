import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUserProfile, type AppProfile } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminDbRole } from "@/lib/userRoles";
import { isWorkOsMigrationRequired } from "@/lib/work-os";

export type WorkOsOrgRole = "employee" | "manager" | "admin";

interface WorkOsRequestContext {
  user: { id: string };
  profile: AppProfile;
}

export interface WorkOsAccess {
  ctx: WorkOsRequestContext;
  organizationId: string;
  role: WorkOsOrgRole;
  personId: string | null;
  membershipId: string;
  featureFlags: Record<string, boolean>;
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

async function resolveDesktopContext(authorization: string) {
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  const supabase = createAdminClient();
  const { data: session, error: sessionError } = await supabase
    .from("work_desktop_sessions")
    .select("id, organization_id, user_id, expires_at, revoked_at")
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
  await supabase.from("work_desktop_sessions").update({ last_used_at: new Date().toISOString() }).eq("id", session.id);
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
    .select("id, organization_id, role, person_id, feature_flags")
    .eq("user_id", userId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    if (companionSchemaMissing(error.message)) {
      throw new Error("Work OS Employee Companion migration required: apply supabase/migrations/0010_work_os_employee_companion.sql.");
    }
    throw new Error(`load Work OS membership: ${error.message}`);
  }
  return data;
}

export async function requireWorkOsAccess(options: {
  roles?: WorkOsOrgRole[];
  organizationId?: string | null;
  requirePerson?: boolean;
  authorization?: string | null;
  feature?: string;
} = {}): Promise<WorkOsAccessResult> {
  const desktop = options.authorization ? await resolveDesktopContext(options.authorization) : null;
  if (options.authorization && !desktop) {
    return { response: NextResponse.json({ error: "invalid or expired desktop session" }, { status: 401 }) };
  }
  const ctx: WorkOsRequestContext = desktop ? desktop.ctx : await requireUserProfile();
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
    .select("feature_flags")
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
      role,
      personId: membership.person_id as string | null,
      membershipId: membership.id as string,
      featureFlags,
    } satisfies WorkOsAccess,
  };
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
  const teamIds = (managedTeams ?? []).map((row) => row.team_id as string);
  if (!teamIds.length) return [access.personId];
  const { data: members, error: targetError } = await supabase
    .from("work_team_members")
    .select("person_id")
    .in("team_id", teamIds);
  if (targetError) throw new Error(`check Work OS team access: ${targetError.message}`);
  return [...new Set([access.personId, ...(members ?? []).map((row) => row.person_id as string)])];
}

export async function canAccessWorkOsPerson(access: WorkOsAccess, personId: string) {
  const ids = await accessibleWorkOsPersonIds(access);
  return ids === null || ids.includes(personId);
}

export async function requireWorkOsPersonAccess(access: WorkOsAccess, personId: string) {
  if (await canAccessWorkOsPerson(access, personId)) return null;
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function requireWorkOsAdmin(): Promise<
  | { ctx: WorkOsAccess["ctx"]; access: WorkOsAccess; response?: never }
  | { response: NextResponse; ctx?: never; access?: never }
> {
  const result = await requireWorkOsAccess({ roles: ["admin"] });
  if (result.response) return { response: result.response };
  return { ctx: result.access.ctx, access: result.access };
}

export function jsonError(err: unknown, status = 500) {
  if (isWorkOsMigrationRequired(err)) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Work OS database migration required.",
      migration: "supabase/migrations/0011_work_os_employee_onboarding.sql",
    }, { status: 503 });
  }
  const message = err instanceof Error ? err.message : "Request failed";
  if (message.includes("Employee Companion migration required")) {
    return NextResponse.json({
      error: message,
      migration: "supabase/migrations/0010_work_os_employee_companion.sql",
    }, { status: 503 });
  }
  const code = message.includes("required") || message.includes("not found") || message.includes("must be") ? 400 : status;
  return NextResponse.json({ error: message }, { status: code });
}
