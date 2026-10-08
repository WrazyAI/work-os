import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { getWorkday, resolveMissedClockOut, transitionSession } from "@/lib/work-os-workday";
import { loadPersistedWorktivityAttendance } from "@/lib/work-os-attendance";
import { worktivityAuthoritativeBreaks } from "@/lib/work-os-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), authorization: req.headers.get("authorization"),
cadenceMinutes: req.headers.get("x-work-os-cadence-minutes"),
firstFollowUpMinutes: req.headers.get("x-work-os-first-follow-up-minutes"), requirePerson: true, feature: "employee_companion" });
}
export async function GET(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const [attendance, authoritativeBreaks] = await Promise.all([loadPersistedWorktivityAttendance(auth.access), worktivityAuthoritativeBreaks(auth.access.organizationId)]); return NextResponse.json({ ...(await getWorkday(auth.access)), attendance, breakPolicy: { worktivityAuthoritative: authoritativeBreaks } }); } catch (error) { return jsonError(error); } }
export async function POST(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; return NextResponse.json({ error: "Attendance is controlled by Worktivity from the Windows Companion. Use its Worktivity clock controls." }, { status: 409 }); } catch (error) { return jsonError(error); } }
export async function PATCH(req: Request) {
  try {
    const auth = await access(req); if (auth.response) return auth.response;
    const key = req.headers.get("idempotency-key"); if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    const body = await req.json();
    if (body.action === "resolve_missed_clock_out") return NextResponse.json(await resolveMissedClockOut(auth.access, body, key));
    if (body.action !== "late_reason") return NextResponse.json({ error: "Attendance is controlled by Worktivity from the Windows Companion. Use its Worktivity clock controls." }, { status: 409 });
    return NextResponse.json(await transitionSession(auth.access, body, key));
  } catch (error) { return jsonError(error); }
}
