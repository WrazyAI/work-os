import { NextResponse } from "next/server";
import { synthesizeInsights } from "@/lib/aiInsights";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import type { InsightRange } from "@/lib/work-os-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANGES: InsightRange[] = ["day", "7d", "30d"];

export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = (await req.json().catch(() => ({}))) as { range?: unknown; through?: unknown };
    const range: InsightRange = typeof body.range === "string" && RANGES.includes(body.range as InsightRange) ? body.range as InsightRange : "7d";
    const through = typeof body.through === "string" && body.through.trim() ? body.through.trim() : null;
    const result = await synthesizeInsights(auth.access, range, through);
    if (!result.ok) {
      const status = result.reason === "ai_unconfigured" ? 501 : 503;
      return NextResponse.json({ error: result.detail ?? "AI synthesis unavailable", reason: result.reason }, { status });
    }
    return NextResponse.json({ synthesis: result.synthesis, mode: result.mode, model: result.model });
  } catch (error) {
    return jsonError(error);
  }
}
