import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsonError, requireWorkOsAccess, type WorkOsOrgRole } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FEATURES = new Set(["employee_companion", "github_evidence", "ghl_evidence", "screenshot_summaries", "desktop_companion", "seo_mission_control"]);

async function adminAccess() {
  return requireWorkOsAccess({ roles: ["admin"] });
}

async function audit(organizationId: string, actor: string, action: string, targetType: string, targetId: string, metadata = {}) {
  const { error } = await createAdminClient().from("work_audit_log").insert({
    organization_id: organizationId, actor_user_id: actor, action, target_type: targetType, target_id: targetId, metadata,
  });
  if (error) throw new Error(`write Work OS audit log: ${error.message}`);
}

export async function GET() {
  try {
    const auth = await adminAccess();
    if (auth.response) return auth.response;
    const db = createAdminClient();
    const [organization, memberships, teams, teamMembers] = await Promise.all([
      db.from("work_organizations").select("id,name,slug,feature_flags,created_at").eq("id", auth.access.organizationId).single(),
      db.from("work_org_members").select("id,user_id,person_id,role,active,feature_flags,person:work_people(id,display_name,email)").eq("organization_id", auth.access.organizationId).order("created_at"),
      db.from("work_teams").select("*").eq("organization_id", auth.access.organizationId).order("name"),
      db.from("work_team_members").select("team_id,person_id,is_manager,person:work_people(id,display_name,email)"),
    ]);
    for (const result of [organization, memberships, teams, teamMembers]) if (result.error) throw result.error;
    const teamIds = new Set((teams.data ?? []).map((team) => team.id));
    return NextResponse.json({
      organization: organization.data,
      memberships: memberships.data ?? [],
      teams: teams.data ?? [],
      teamMembers: (teamMembers.data ?? []).filter((member) => teamIds.has(member.team_id)),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await adminAccess();
    if (auth.response) return auth.response;
    const body = await req.json() as Record<string, unknown>;
    const db = createAdminClient();
    if (body.type === "team") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
      const { data, error } = await db.from("work_teams").insert({ organization_id: auth.access.organizationId, name, created_by: auth.access.ctx.user.id }).select("*").single();
      if (error) throw error;
      await audit(auth.access.organizationId, auth.access.ctx.user.id, "team.created", "team", data.id, { name });
      return NextResponse.json({ team: data }, { status: 201 });
    }
    if (body.type === "team_member") {
      const teamId = String(body.team_id || "");
      const personId = String(body.person_id || "");
      const [{ data: team }, { data: person }] = await Promise.all([
        db.from("work_teams").select("id").eq("organization_id", auth.access.organizationId).eq("id", teamId).maybeSingle(),
        db.from("work_people").select("id").eq("organization_id", auth.access.organizationId).eq("id", personId).maybeSingle(),
      ]);
      if (!team || !person) return NextResponse.json({ error: "team and person must belong to the organization" }, { status: 400 });
      const { data, error } = await db.from("work_team_members").upsert({ team_id: teamId, person_id: personId, is_manager: body.is_manager === true }, { onConflict: "team_id,person_id" }).select("*").single();
      if (error) throw error;
      await audit(auth.access.organizationId, auth.access.ctx.user.id, "team.membership_saved", "team", teamId, { personId, isManager: data.is_manager });
      return NextResponse.json({ teamMember: data }, { status: 201 });
    }
    if (body.type === "membership") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const role = body.role as WorkOsOrgRole;
      if (!email || !["employee", "manager", "admin"].includes(role)) return NextResponse.json({ error: "valid email and role are required" }, { status: 400 });
      const { data: profile, error: profileError } = await db.from("profiles").select("id,email").ilike("email", email).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return NextResponse.json({ error: "A WrazyOS user with that email must sign up first." }, { status: 409 });
      const { data: person } = await db.from("work_people").select("id").eq("organization_id", auth.access.organizationId).ilike("email", email).maybeSingle();
      const { data, error } = await db.from("work_org_members").upsert({
        organization_id: auth.access.organizationId, user_id: profile.id, person_id: person?.id ?? null, role, active: true,
      }, { onConflict: "organization_id,user_id" }).select("*").single();
      if (error) throw error;
      if (person) await db.from("work_people").update({ auth_user_id: profile.id, updated_at: new Date().toISOString() }).eq("id", person.id);
      await audit(auth.access.organizationId, auth.access.ctx.user.id, "organization.membership_saved", "membership", data.id, { role, email });
      return NextResponse.json({ membership: data }, { status: 201 });
    }
    return NextResponse.json({ error: "unsupported organization operation" }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await adminAccess();
    if (auth.response) return auth.response;
    const body = await req.json() as Record<string, unknown>;
    const db = createAdminClient();
    if (body.feature_flags && typeof body.feature_flags === "object") {
      const flags = Object.fromEntries(Object.entries(body.feature_flags as Record<string, unknown>).filter(([key, value]) => FEATURES.has(key) && typeof value === "boolean"));
      const { data: current, error: loadError } = await db.from("work_organizations").select("feature_flags").eq("id", auth.access.organizationId).single();
      if (loadError) throw loadError;
      const { data, error } = await db.from("work_organizations").update({ feature_flags: { ...(current.feature_flags ?? {}), ...flags }, updated_at: new Date().toISOString() }).eq("id", auth.access.organizationId).select("*").single();
      if (error) throw error;
      await audit(auth.access.organizationId, auth.access.ctx.user.id, "organization.features_updated", "organization", auth.access.organizationId, { flags });
      return NextResponse.json({ organization: data });
    }
    const membershipId = String(body.membership_id || "");
    const { data: currentMembership, error: currentError } = await db.from("work_org_members")
      .select("id,role,active,feature_flags").eq("organization_id", auth.access.organizationId).eq("id", membershipId).maybeSingle();
    if (currentError) throw currentError;
    if (!currentMembership) return NextResponse.json({ error: "membership not found" }, { status: 404 });
    const removesAdmin = currentMembership.role === "admin" && currentMembership.active &&
      (body.active === false || (body.role && body.role !== "admin"));
    if (removesAdmin) {
      const { count, error: countError } = await db.from("work_org_members").select("id", { count: "exact", head: true })
        .eq("organization_id", auth.access.organizationId).eq("role", "admin").eq("active", true);
      if (countError) throw countError;
      if ((count ?? 0) <= 1) return NextResponse.json({ error: "organization must retain at least one active admin" }, { status: 409 });
    }
    if (typeof body.person_id === "string") {
      const { data: person, error: personError } = await db.from("work_people").select("id")
        .eq("organization_id", auth.access.organizationId).eq("id", body.person_id).maybeSingle();
      if (personError) throw personError;
      if (!person) return NextResponse.json({ error: "person must belong to the organization" }, { status: 400 });
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (["employee", "manager", "admin"].includes(String(body.role))) patch.role = body.role;
    if (typeof body.active === "boolean") patch.active = body.active;
    if (body.person_id === null || typeof body.person_id === "string") patch.person_id = body.person_id;
    if (body.feature_flags && typeof body.feature_flags === "object") {
      patch.feature_flags = {
        ...(currentMembership.feature_flags ?? {}),
        ...Object.fromEntries(Object.entries(body.feature_flags as Record<string, unknown>)
          .filter(([key, value]) => FEATURES.has(key) && typeof value === "boolean")),
      };
    }
    const { data: membership, error } = await db.from("work_org_members").update(patch).eq("organization_id", auth.access.organizationId).eq("id", membershipId).select("*").maybeSingle();
    if (error) throw error;
    await audit(auth.access.organizationId, auth.access.ctx.user.id, "organization.membership_updated", "membership", membershipId, { patch });
    return NextResponse.json({ membership });
  } catch (error) {
    return jsonError(error);
  }
}
