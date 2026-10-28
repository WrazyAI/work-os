import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { adminOttoWindowsFromQuery, listAdminOttoRecords } from "@/lib/work-os-admin-otto-reads";
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

/** Read-only record projection for explicit local windows or person ids. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req);
    if (auth.response) return wired(auth.response);
    const sp = new URL(req.url).searchParams;
    const windows = await adminOttoWindowsFromQuery(auth.access, sp);
    const page = await listAdminOttoRecords(auth.access, {
      windows,
      cursor: sp.get("cursor") ?? undefined,
    });
    return NextResponse.json({ schemaVersion: 1, ...page }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return wired(jsonError(error));
  }
}
