import { NextResponse } from "next/server";
import { getWorkOsDay } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const url = new URL(req.url);
    const atValue = url.searchParams.get("at");
    const at = atValue ? new Date(atValue) : new Date();
    if (Number.isNaN(at.getTime())) return NextResponse.json({ error: "at must be a valid timestamp" }, { status: 400 });
    const day = await getWorkOsDay(auth.access, auth.access.personId as string, at, {
      refreshNifty: url.searchParams.get("refreshProviders") === "true",
      refreshAttendance: url.searchParams.get("refreshAttendance") === "true",
      compact: url.searchParams.get("compact") === "true",
    }) as Record<string, unknown>;
    return NextResponse.json({
      ...day,
      access: {
        organizationId: auth.access.organizationId,
        role: auth.access.role,
        personId: auth.access.personId,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
