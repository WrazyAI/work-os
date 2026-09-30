import { NextResponse } from "next/server";
import { listAdminActivityIntervals } from "@/lib/work-os-activity-intervals";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    roles: ["manager", "admin"],
  });
  if (auth.response) return auth.response;
  try {
    const params = new URL(req.url).searchParams;
    const personId = params.get("personId");
    if (personId) {
      const denied = await requireWorkOsPersonAccess(auth.access, personId);
      if (denied) return denied;
    }
    // Managers only ever see the people their teams cover; admins receive the
    // whole organization (null).
    const allowedPersonIds = await accessibleWorkOsPersonIds(auth.access);
    const rawLimit = params.get("limit");
    const limitParam = rawLimit == null || rawLimit === "" ? Number.NaN : Number(rawLimit);
    const intervals = await listAdminActivityIntervals(auth.access, {
      from: params.get("from"),
      to: params.get("to"),
      personId,
      personIds: allowedPersonIds,
      limit: Number.isFinite(limitParam) ? limitParam : undefined,
    });
    return NextResponse.json({ intervals });
  } catch (error) {
    return jsonError(error);
  }
}
