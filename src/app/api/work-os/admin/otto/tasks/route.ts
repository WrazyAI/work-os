import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { listAdminOttoTasks } from "@/lib/work-os-admin-otto-reads";
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

/** Open backlog for the team (no personIds) or explicit people. */
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req);
    if (auth.response) return wired(auth.response);
    const sp = new URL(req.url).searchParams;
    const rawPeople = sp.get("personIds");
    const personIds = rawPeople === null
      ? null
      : rawPeople.split(",").map((value) => value.trim()).filter(Boolean);
    const rawLimit = sp.get("limit");
    const rawDate = sp.get("date");
    const now = rawDate === null ? new Date() : new Date(`${rawDate}T12:00:00.000Z`);
    const page = await listAdminOttoTasks(auth.access, {
      personIds,
      overdueOnly: sp.get("overdue") === "true",
      cursor: sp.get("cursor") ?? undefined,
      limit: rawLimit === null ? undefined : Number(rawLimit),
      now,
    });
    return NextResponse.json({ schemaVersion: 1, ...page }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return wired(jsonError(error));
  }
}
