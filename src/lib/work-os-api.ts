import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUserProfile, type AppProfile } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminDbRole } from "@/lib/userRoles";
import { isWorkOsMigrationRequired } from "@/lib/work-os";
import {
  selectWorkOsMembership,
  type WorkOsMembershipCandidate,
  type WorkOsMembershipSelection,
} from "@/lib/work-os-membership";
import { checkInIntervalOption, firstFollowUpOption } from "@/modules/work-os/workday";
import {
  isWorkOsOrganizationId,
  WORK_OS_WORKSPACE_COOKIE,
  type WorkOsWorkspaceChoice,
} from "@/modules/work-os/workspace";

export type WorkOsOrgRole = "employee" | "manager" | "admin";

interface WorkOsRequestContext {
  user: { id: string };
  profile: AppProfile;
}

export interface WorkOsAccess {
  ctx: WorkOsRequestContext;
  organizationId: string;
  organizationName: string;
  organizationOwnerId: string | null;
  role: WorkOsOrgRole;
  personId: string | null;
  membershipId: string;
  featureFlags: Record<string, boolean>;
  /** Every active workspace this account may enter, so the shell can show the
   * active workspace and offer an explicit switch. */
  workspaces: WorkOsWorkspaceChoice[];
  /** Cadence the installed app reports from its own local config file, so an
   * edit on one machine applies to that machine only. Validated against the
   * same bounds as every other cadence source; absent when unset or invalid. */
  localCadence?: {
    checkInIntervalMinutes?: number;
    firstFollowUpMinutes?: number;
  };
}

export class WorkOsConflictError extends Error {
  /** A machine-readable reason a client can act on (for example
   * `shift_open`), so it can show the right prompt instead of a generic
   * failure. */
  reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.name = "WorkOsConflictError";
    this.reason = reason;
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

/** A record the caller cannot see: missing, archived, tombstoned, or owned by
 * another person or workspace. `jsonError` maps it to 404 so a removed task is
 * never reported as a caller mistake or an upstream failure. */
export class WorkOsNotFoundError extends Error {
  constructor(message = "Task not found") {
    super(message);
    this.name = "WorkOsNotFoundError";
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

interface WorkOsMembershipRow extends WorkOsMembershipCandidate {
  organization?: { name?: unknown } | Array<{ name?: unknown }> | null;
}

function embeddedOrganizationName(value: WorkOsMembershipRow["organization"]): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  const name = row && typeof row === "object" ? row.name : null;
  return typeof name === "string" && name.trim() ? name : null;
}

/** Every active workspace for this account, with its own name and role. */
async function loadWorkOsMemberships(userId: string): Promise<WorkOsMembershipRow[]> {
  const { data, error } = await createAdminClient()
    .from("work_org_members")
    .select("id, organization_id, role, person_id, feature_flags, created_at, organization:work_organizations(name)")
    .eq("user_id", userId)
    .eq("active", true);
  if (error) {
    if (companionSchemaMissing(error.message)) {
      throw new Error("Work OS Employee Companion migration required: apply supabase/migrations/0010_work_os_employee_companion.sql.");
    }
    throw new Error(`load Work OS membership: ${error.message}`);
  }
  return ((data ?? []) as WorkOsMembershipRow[]).map((row) => ({
    ...row,
    organization_name: embeddedOrganizationName(row.organization),
  }));
}

function workspaceChoices(rows: readonly WorkOsMembershipRow[]): WorkOsWorkspaceChoice[] {
  return rows.map((row) => ({
    organizationId: row.organization_id,
    name: row.organization_name ?? "Workspace",
    role: row.role as WorkOsOrgRole,
    personId: row.person_id,
  }));
}

/**
 * The workspace chosen for this device, if any.
 *
 * `cookies()` is only available in a request context; scripts and pure callers
 * simply have no stored choice.
 */
export async function readWorkOsOrganizationCookie(): Promise<string | null> {
  try {
    const store = await cookies();
    const value = store.get(WORK_OS_WORKSPACE_COOKIE)?.value;
    return isWorkOsOrganizationId(value) ? value : null;
  } catch {
    return null;
  }
}

/** The caller's own workspaces, for the chooser and the desktop connect page. */
export async function listWorkOsWorkspaces(userId: string): Promise<WorkOsWorkspaceChoice[]> {
  return workspaceChoices(await loadWorkOsMemberships(userId));
}

/**
 * Whether this account can still enter My workspace as a mapped admin.
 *
 * The web view switch is a presentation preference, so the console gate and
 * the root page only redirect into the employee workspace while the account
 * still has at least one membership and person record that made the switch
 * possible. A removed mapping or a demoted role in one workspace must not hide
 * a mapped admin's workday in another, so this checks every active membership.
 * This is one read-only membership lookup, not an authorization decision.
 */
export async function hasMappedWorkOsAdminMembership(userId: string): Promise<boolean> {
  try {
    const memberships = await loadWorkOsMemberships(userId);
    return memberships.some((membership) => membership.role === "admin" && membership.person_id);
  } catch {
    // The console is not the employee workspace: an unreadable membership
    // record must leave the administrator in Administration, not turn a stale
    // presentation cookie into a console error.
    return false;
  }
}

interface WorkOsAccessOptions {
  roles?: WorkOsOrgRole[];
  organizationId?: string | null;
  requirePerson?: boolean;
  authorization?: string | null;
  feature?: string;
  /** Raw `x-work-os-cadence-minutes` header from the installed app. */
  cadenceMinutes?: string | null;
  /** Raw `x-work-os-first-follow-up-minutes` header from the installed app. */
  firstFollowUpMinutes?: string | null;
}

type WorkOsResolvedAccess =
  | { kind: "access"; access: WorkOsAccess }
  | { kind: "response"; response: NextResponse }
  | { kind: "selection"; choices: WorkOsWorkspaceChoice[] };

export type WorkOsSessionResolution =
  | { access: WorkOsAccess }
  | { choices: WorkOsWorkspaceChoice[] }
  | { response: NextResponse };

/**
 * Resolve the caller's workspace.
 *
 * An explicit organization (desktop bearer session or `x-work-os-organization-id`)
 * wins, then this device's `work-os-org` cookie. With neither, exactly one
 * active membership selects itself; more than one returns `selection` so the
 * caller must ask. The resolver never chooses between two workspaces.
 */
async function resolveWorkOsAccess(options: WorkOsAccessOptions = {}): Promise<WorkOsResolvedAccess> {
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
    return { kind: "response", response: NextResponse.json({ error: "invalid or expired desktop session" }, { status: 401 }) };
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
      return { kind: "response", response: NextResponse.json({ error: "authentication required" }, { status: 401 }) };
    }
    throw err;
  }
  const headerOrganizationId = typeof options.organizationId === "string" && options.organizationId.trim()
    ? options.organizationId.trim()
    : null;
  const explicitOrganizationId = desktop?.organizationId ?? headerOrganizationId ?? null;
  if (desktop && headerOrganizationId && headerOrganizationId !== desktop.organizationId) {
    return { kind: "response", response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  // The web has no bearer session; its per-device choice lives in a cookie.
  const cookieOrganizationId = !desktop && !headerOrganizationId
    ? await readWorkOsOrganizationCookie()
    : null;
  const requestedOrganizationId = explicitOrganizationId ?? cookieOrganizationId;
  let memberships = await loadWorkOsMemberships(ctx.profile.id);
  let selection: WorkOsMembershipSelection<WorkOsMembershipRow> = selectWorkOsMembership(memberships, requestedOrganizationId);
  if (selection.kind === "none" && memberships.length === 0 && !explicitOrganizationId && isAdminDbRole(ctx.profile.role)) {
    await ensureOwnerOrganization(ctx);
    memberships = await loadWorkOsMemberships(ctx.profile.id);
    selection = selectWorkOsMembership(memberships, null);
  }
  if (selection.kind === "none" && cookieOrganizationId && !explicitOrganizationId) {
    // A stale or revoked cookie is not an authorization failure: fall back to
    // the account's only remaining workspace, or ask it to choose again.
    selection = selectWorkOsMembership(memberships, null);
  }
  if (selection.kind === "required") {
    return { kind: "selection", choices: workspaceChoices(selection.memberships) };
  }
  if (selection.kind === "none") {
    return { kind: "response", response: NextResponse.json({ error: "Work OS organization membership required." }, { status: 403 }) };
  }

  const membership = selection.membership;
  const role = membership.role as WorkOsOrgRole;
  const { data: organization, error: organizationError } = await createAdminClient()
    .from("work_organizations")
    .select("name, feature_flags, legacy_owner_id, created_by")
    .eq("id", membership.organization_id)
    .single();
  if (organizationError) throw new Error(`load Work OS feature flags: ${organizationError.message}`);
  const featureFlags = {
    ...((organization.feature_flags ?? {}) as Record<string, boolean>),
    ...((membership.feature_flags ?? {}) as Record<string, boolean>),
  };
  if (options.feature && featureFlags[options.feature] !== true) {
    return { kind: "response", response: NextResponse.json({ error: "Work OS feature is not enabled for this organization or employee." }, { status: 403 }) };
  }
  if (options.roles && !options.roles.includes(role)) {
    return { kind: "response", response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  if (options.requirePerson && !membership.person_id) {
    return { kind: "response", response: NextResponse.json({ error: "Work OS person mapping required." }, { status: 409 }) };
  }
  return {
    kind: "access",
    access: {
      ctx,
      organizationId: membership.organization_id as string,
      organizationName: String(organization.name ?? membership.organization_name ?? "Workspace"),
      organizationOwnerId: ((organization.legacy_owner_id || organization.created_by) as string | null) ?? null,
      role,
      personId: membership.person_id as string | null,
      membershipId: membership.id as string,
      featureFlags,
      workspaces: workspaceChoices(memberships),
      ...(localCadence ? { localCadence } : {}),
    } satisfies WorkOsAccess,
  };
}

export async function requireWorkOsAccess(options: WorkOsAccessOptions = {}): Promise<WorkOsAccessResult> {
  const resolved = await resolveWorkOsAccess(options);
  if (resolved.kind === "response") return { response: resolved.response };
  if (resolved.kind === "selection") {
    const response = NextResponse.json({
      error: "workspace_selection_required",
      reason: "workspace_selection_required",
      organizations: resolved.choices,
    }, { status: 409 });
    response.headers.set("x-work-os-workspace-selection", "required");
    response.headers.set("Cache-Control", "no-store");
    return { response };
  }
  return { access: resolved.access };
}

/** Session/page callers can render the chooser instead of treating it as 409. */
export async function resolveWorkOsSession(
  options: { organizationId?: string | null; authorization?: string | null } = {},
): Promise<WorkOsSessionResolution> {
  const resolved = await resolveWorkOsAccess(options);
  if (resolved.kind === "access") return { access: resolved.access };
  if (resolved.kind === "selection") return { choices: resolved.choices };
  return { response: resolved.response };
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
  // Honor the caller's selected organization. Without an explicit choice the
  // resolver only proceeds when the account has exactly one active membership;
  // two or more return a selection-required response instead of silently
  // reading or writing the wrong tenant. A desktop bearer token authorizes the
  // same membership as a browser cookie.
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
    return NextResponse.json({ error: err.message, ...(err.reason ? { reason: err.reason } : {}) }, { status: 409 });
  }
  if (err instanceof WorkOsNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
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
