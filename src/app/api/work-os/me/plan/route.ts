import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { getWorkday, saveDailyPlan } from "@/lib/work-os-workday";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function access(req: Request) { return requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), authorization: req.headers.get("authorization"), requirePerson: true, feature: "employee_companion" }); }
export async function GET(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const result = await getWorkday(auth.access); return NextResponse.json({ plan: result.plan }); } catch (error) { return jsonError(error); } }
export async function PATCH(req: Request) { try { const auth = await access(req); if (auth.response) return auth.response; const key = req.headers.get("idempotency-key"); if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 }); return NextResponse.json(await saveDailyPlan(auth.access, await req.json(), key)); } catch (error) { return jsonError(error); } }
