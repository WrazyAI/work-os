import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { clockIn, getWorkday, transitionSession } from "@/lib/work-os-workday";
import { reconcileWorktivityAttendance } from "@/lib/work-os-attendance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), authorization: req.headers.get("authorization"), requirePerson: true, feature: "employee_companion" });
}
export async function GET(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const attendance = await reconcileWorktivityAttendance(auth.access); return NextResponse.json({ ...(await getWorkday(auth.access)), attendance: attendance.attendance }); } catch (error) { return jsonError(error); } }
export async function POST(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const key = req.headers.get("idempotency-key"); if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 }); const body = await req.json(); const attendance = await reconcileWorktivityAttendance(auth.access); if (!attendance.attendance.fallbackAllowed) return NextResponse.json({ error: "Attendance is managed by Worktivity while its status is available." }, { status: 409 }); return NextResponse.json(await clockIn(auth.access, { ...body, source: "work_os_fallback" }, key), { status: 201 }); } catch (error) { return jsonError(error); } }
export async function PATCH(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const key = req.headers.get("idempotency-key"); if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 }); return NextResponse.json(await transitionSession(auth.access, await req.json(), key)); } catch (error) { return jsonError(error); } }
