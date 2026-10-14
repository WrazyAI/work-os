import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { listRoleProfiles, updatePerson } from "@/lib/work-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ authorization: req.headers.get("authorization"), organizationId: req.headers.get("x-work-os-organization-id"), roles: ["manager", "admin"] });
    if (auth.response) return auth.response;
    const personIds = await accessibleWorkOsPersonIds(auth.access);
    if (personIds && !personIds.length) return NextResponse.json({ people: [], roleProfiles: [] });
    let query = createAdminClient().from("work_people")
      .select("*, role_profile:work_role_profiles(*)").eq("organization_id", auth.access.organizationId);
    if (personIds) query = query.in("id", personIds);
    const { data, error } = await query.order("display_name");
    if (error) throw new Error(`load Work OS people: ${error.message}`);
    const ownerId = auth.access.role === "admin" ? workOsOrganizationOwnerId(auth.access) : null;
    const roleProfiles = ownerId ? await listRoleProfiles(ownerId) : [];
    return NextResponse.json({ people: data ?? [], roleProfiles });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ roles: ["admin"] });
    if (auth.response) return auth.response;
    const body = await req.json();
    if (!body?.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const ownerId = workOsOrganizationOwnerId(auth.access);
    return NextResponse.json({ person: await updatePerson(ownerId, body.id, body) });
  } catch (error) {
    return jsonError(error);
  }
}
