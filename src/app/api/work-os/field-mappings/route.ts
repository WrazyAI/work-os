import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELDS = new Set(["priority", "blocked_reason", "estimated_effort_minutes", "expected_outcome", "definition_of_done"]);

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
    if (auth.response) return auth.response;
    const { data, error } = await createAdminClient().from("work_provider_field_mappings").select("*").eq("organization_id", auth.access.organizationId).order("semantic_field");
    if (error) throw new Error(`load provider field mappings: ${error.message}`);
    return NextResponse.json({ mappings: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
    if (auth.response) return auth.response;
    const body = await req.json();
    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const field = typeof body.semantic_field === "string" ? body.semantic_field.trim() : "";
    const providerFieldId = typeof body.provider_field_id === "string" ? body.provider_field_id.trim() : "";
    if (!provider || !FIELDS.has(field) || !providerFieldId) return NextResponse.json({ error: "valid provider, semantic_field, and provider_field_id are required" }, { status: 400 });
    const db = createAdminClient();
    const { data, error } = await db.from("work_provider_field_mappings").upsert({
      organization_id: auth.access.organizationId, provider, semantic_field: field, provider_field_id: providerFieldId,
      config: body.config && typeof body.config === "object" ? body.config : {}, updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,provider,semantic_field" }).select("*").single();
    if (error) throw new Error(`save provider field mapping: ${error.message}`);
    await db.from("work_audit_log").insert({ organization_id: auth.access.organizationId, actor_user_id: auth.access.ctx.user.id, action: "provider_field_mapping.saved", target_type: "provider_field_mapping", target_id: data.id, metadata: { provider, field } });
    return NextResponse.json({ mapping: data });
  } catch (error) {
    return jsonError(error);
  }
}
