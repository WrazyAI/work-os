import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";
import { loadWorkOsReadinessReport } from "@/lib/work-os-readiness-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json(await loadWorkOsReadinessReport(auth.access));
  } catch (error) {
    return jsonError(error);
  }
}
