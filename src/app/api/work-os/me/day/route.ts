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
    const dateValue = url.searchParams.get("date");
    let localDate: string | null = null;
    if (dateValue !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return NextResponse.json({ error: "date must be a valid calendar date" }, { status: 400 });
      const parsed = new Date(`${dateValue}T12:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateValue) {
        return NextResponse.json({ error: "date must be a valid calendar date" }, { status: 400 });
      }
      localDate = dateValue;
    }
    const atValue = url.searchParams.get("at");
    const at = localDate ? new Date(`${localDate}T12:00:00Z`) : atValue ? new Date(atValue) : new Date();
    if (Number.isNaN(at.getTime())) return NextResponse.json({ error: "at must be a valid timestamp" }, { status: 400 });
    const day = await getWorkOsDay(auth.access, auth.access.personId as string, at, {
      refreshNifty: url.searchParams.get("refreshProviders") === "true",
      refreshAttendance: url.searchParams.get("refreshAttendance") === "true",
      compact: url.searchParams.get("compact") === "true",
      localDate,
    }) as Record<string, unknown>;
    return NextResponse.json({
      ...day,
      access: {
        organizationId: auth.access.organizationId,
        role: auth.access.role,
        personId: auth.access.personId,
        featureFlags: auth.access.featureFlags,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
