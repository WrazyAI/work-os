import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { listAdminOttoPeople } from "@/lib/work-os-admin-otto-reads";
import { jsonError } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function wired(response: NextResponse) {
  const body = await response.json().catch(() => ({}));
  return NextResponse.json({ schemaVersion: 1, ...body }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Bounded active directory page. Name resolution still searches the complete
 * authorized roster through the read service. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req);
    if (auth.response) return wired(auth.response);
    const sp = new URL(req.url).searchParams;
    const rawLimit = sp.get("limit");
    const rawIds = sp.get("ids");
    const page = await listAdminOttoPeople(auth.access, {
      cursor: sp.get("cursor") ?? undefined,
      limit: rawLimit === null ? undefined : Number(rawLimit),
      ...(rawIds === null ? {} : { ids: rawIds.split(",").filter(Boolean) }),
    });
    return NextResponse.json({ schemaVersion: 1, ...page }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return wired(jsonError(error));
  }
}
