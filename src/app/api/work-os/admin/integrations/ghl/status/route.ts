import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGhlStatus } from "@/lib/work-os-ghl-sync";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      authorization: req.headers.get("authorization"),
      organizationId: req.headers.get("x-work-os-organization-id"),
      roles: ["admin"],
    });
    if (auth.response) return auth.response;
    const { data: connection, error } = await createAdminClient()
      .from("work_provider_connections")
      .select("id,external_workspace_id,active,config")
      .eq("organization_id", auth.access.organizationId)
      .eq("provider", "ghl")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`load GHL connection: ${error.message}`);
    if (!connection) return NextResponse.json({ mode: "pit_polling", state: "not_connected", coverage: [], lastSyncedAt: null, nextDueAt: null });
    const status = connection.active === false
      ? { mode: "pit_polling", state: "disconnected", coverage: [], lastSyncedAt: null, nextDueAt: null }
      : await getGhlStatus({
        organizationId: auth.access.organizationId,
        connectionId: String(connection.id),
        locationId: String(connection.external_workspace_id),
      });
    return NextResponse.json(status);
  } catch (error) {
    return jsonError(error);
  }
}
