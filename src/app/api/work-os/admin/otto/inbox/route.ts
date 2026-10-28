import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { listAdminRecapInbox } from "@/lib/work-os-admin-otto-inbox";
import { jsonError } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every response, including a denial, carries the shared envelope and no-store. */
async function wired(response: NextResponse) {
  const body = await response.json().catch(() => ({}));
  return NextResponse.json({ schemaVersion: 1, ...body }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Newest-first paged read. Materialization happens under the admin's own lock;
 * a denied request cannot consume its cursor. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req);
    if (auth.response) return wired(auth.response);
    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && (cursor === "" || cursor.length > 256)) {
      return wired(badRequest("cursor is invalid"));
    }
    const rawLimit = url.searchParams.get("limit");
    if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
      return wired(badRequest("limit must be an integer between 1 and 100"));
    }
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (limit < 1 || limit > 100)) {
      return wired(badRequest("limit must be an integer between 1 and 100"));
    }
    const page = await listAdminRecapInbox(auth.access, {
      cursor: cursor ?? undefined,
      limit,
    });
    return NextResponse.json({ schemaVersion: 1, ...page }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return wired(jsonError(error));
  }
}
