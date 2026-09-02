import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { clockIn, getWorkday, resolveMissedClockOut, transitionSession } from "@/lib/work-os-workday";
import { loadPersistedWorktivityAttendance, refreshWorktivityProviderBreaks } from "@/lib/work-os-attendance";
import { worktivityAuthoritativeBreaks } from "@/lib/work-os-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), authorization: req.headers.get("authorization"), requirePerson: true, feature: "employee_companion" });
}
export async function GET(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const [attendance, authoritativeBreaks] = await Promise.all([loadPersistedWorktivityAttendance(auth.access), worktivityAuthoritativeBreaks(auth.access.organizationId)]); return NextResponse.json({ ...(await getWorkday(auth.access)), attendance, breakPolicy: { worktivityAuthoritative: authoritativeBreaks } }); } catch (error) { return jsonError(error); } }
export async function POST(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const key = req.headers.get("idempotency-key"); if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 }); const body = await req.json(); const source = body.source === "desktop" ? "desktop" : "web"; return NextResponse.json(await clockIn(auth.access, { ...body, source }, key), { status: 201 }); } catch (error) { return jsonError(error); } }
export async function PATCH(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const key = req.headers.get("idempotency-key"); if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 }); const body = await req.json(); const result = body.action === "resolve_missed_clock_out" ? await resolveMissedClockOut(auth.access, body, key) : await transitionSession(auth.access, body, key); if (body.action === "clock_out" && result.session) result.session = await refreshWorktivityProviderBreaks(auth.access, result.session); return NextResponse.json(result); } catch (error) { return jsonError(error); } }
