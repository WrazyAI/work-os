import { NextResponse } from "next/server";
import { listWorkOsScheduleExceptions, listWorkOsSchedules, saveWorkOsSchedule, saveWorkOsScheduleException } from "@/lib/work-os-companion";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ authorization: req.headers.get("authorization"), organizationId: req.headers.get("x-work-os-organization-id") });
    if (auth.response) return auth.response;
    const requestedPersonId = new URL(req.url).searchParams.get("personId");
    const personScope = requestedPersonId
      ? requestedPersonId
      : await accessibleWorkOsPersonIds(auth.access);
    if (typeof personScope === "string") {
      const denied = await requireWorkOsPersonAccess(auth.access, personScope);
      if (denied) return denied;
    }
    if (Array.isArray(personScope) && !personScope.length) return NextResponse.json({ schedules: [], exceptions: [] });
    const [schedules, exceptions] = await Promise.all([
      listWorkOsSchedules(auth.access, personScope),
      listWorkOsScheduleExceptions(auth.access, personScope),
    ]);
    return NextResponse.json({ schedules, exceptions });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      authorization: req.headers.get("authorization"),
      organizationId: req.headers.get("x-work-os-organization-id"),
      roles: ["manager", "admin"],
    });
    if (auth.response) return auth.response;
    const body = await req.json();
    const personId = typeof body.person_id === "string" ? body.person_id : "";
    const denied = await requireWorkOsPersonAccess(auth.access, personId);
    if (denied) return denied;
    if (body.exception_date) {
      return NextResponse.json({ exception: await saveWorkOsScheduleException(auth.access, body) });
    }
    return NextResponse.json({ schedule: await saveWorkOsSchedule(auth.access, body) });
  } catch (error) {
    return jsonError(error);
  }
}
