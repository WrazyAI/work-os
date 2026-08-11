import { NextResponse } from "next/server";
import { niftyOrganizationConfigStatus } from "@/lib/integrations/nifty";
import { checkWorkOsSchemaReady } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({
      schema: await checkWorkOsSchemaReady(),
      nifty: await niftyOrganizationConfigStatus(auth.access.organizationId),
    });
  } catch (err) {
    return jsonError(err);
  }
}
