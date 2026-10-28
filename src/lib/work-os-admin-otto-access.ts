import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserProfile } from "@/lib/supabase/auth";
import { requireWorkOsAccess, type WorkOsAccess } from "@/lib/work-os-api";
import { selectWorkOsMembership, type WorkOsMembershipCandidate } from "@/lib/work-os-membership";
import type { OttoScope } from "@/modules/work-os/admin-otto/contracts";

type AdminOttoAccessResult = { access: WorkOsAccess; response?: never } | { response: NextResponse; access?: never };

function denied(status = 403): { response: NextResponse; access?: never } {
  return { response: NextResponse.json({ error: status === 401 ? "authentication required" : "forbidden" }, { status }) };
}

/** A nonempty explicit organization disables legacy owner provisioning in the
 * shared resolver. Never invoke that resolver for Otto without this binding. */
async function requireScopedAdminOttoAccess(
  req: Request,
  organizationId: string,
  capability: "read" | "voice",
): Promise<AdminOttoAccessResult> {
  if (!organizationId) return denied();
  const auth = await requireWorkOsAccess({
    organizationId,
    authorization: req.headers.get("authorization"),
    roles: ["admin"],
    feature: "employee_companion",
  });
  if (auth.response) return auth;
  if (capability === "voice" && auth.access.featureFlags.voice_input !== true) {
    return { response: NextResponse.json({ error: "Work OS voice is not enabled." }, { status: 403 }) };
  }
  return auth;
}

export async function requireAdminOttoAccess(
  req: Request,
  capability: "read" | "voice" = "read",
): Promise<AdminOttoAccessResult> {
  const requestedOrganizationId = req.headers.get("x-work-os-organization-id");
  if (requestedOrganizationId) return requireScopedAdminOttoAccess(req, requestedOrganizationId, capability);

  const authorization = req.headers.get("authorization");
  if (authorization) {
    const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) return denied(401);
    const { data: session, error } = await createAdminClient()
      .from("work_desktop_sessions")
      .select("organization_id")
      .eq("token_hash", createHash("sha256").update(match[1]).digest("hex"))
      .maybeSingle();
    if (error) throw new Error(`load Work OS desktop organization: ${error.message}`);
    if (!session?.organization_id) return denied(401);
    // This lookup selects scope only; the shared resolver still authoritatively
    // checks bearer expiry/revocation, the profile and active membership.
    return requireScopedAdminOttoAccess(req, session.organization_id as string, capability);
  }

  let ctx: Awaited<ReturnType<typeof requireUserProfile>>;
  try {
    ctx = await requireUserProfile();
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return denied(401);
    throw error;
  }
  const { data, error } = await createAdminClient()
    .from("work_org_members")
    .select("id, organization_id, role, person_id, feature_flags, created_at")
    .eq("user_id", ctx.profile.id)
    .eq("active", true);
  if (error) throw new Error(`load Work OS membership: ${error.message}`);
  const selection = selectWorkOsMembership((data ?? []) as WorkOsMembershipCandidate[]);
  if (selection.kind === "none") return denied();
  if (selection.kind === "required") {
    return {
      response: NextResponse.json({
        error: "Choose a workspace before opening administration.",
        reason: "organization_required",
      }, { status: 409 }),
    };
  }
  // Absence of an active membership is a denial, never permission to create or
  // restore one. The installed companion names its workspace explicitly; this
  // cookie-only fallback must not silently pick a tenant when several exist.
  return requireScopedAdminOttoAccess(req, selection.membership.organization_id, capability);
}

/** Recheck after long-running speech work, including voice revocation. Callers
 * must return a thrown Response unchanged rather than sending prepared audio. */
export async function revalidateAdminOttoAccess(req: Request, expected: OttoScope): Promise<WorkOsAccess> {
  const requestedOrganizationId = req.headers.get("x-work-os-organization-id");
  if (expected.mode !== "admin" || !expected.organizationId || (requestedOrganizationId !== null && requestedOrganizationId !== expected.organizationId)) {
    throw denied().response;
  }
  const auth = await requireScopedAdminOttoAccess(req, expected.organizationId, "voice");
  if (auth.response) throw auth.response;
  if (expected.mode !== "admin" || expected.userId !== auth.access.ctx.user.id || expected.organizationId !== auth.access.organizationId) {
    throw NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return auth.access;
}
