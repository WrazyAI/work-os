import { NextResponse } from "next/server";
import { interpretDailyPlan } from "@/lib/aiPlan";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { buildPlanningContext } from "@/lib/work-os-planning-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = await req.json() as { input?: unknown; date?: unknown; conversation?: unknown };
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    const date = body.date;
    const context = await buildPlanningContext(auth.access, date);
    const result = await interpretDailyPlan({ rawIntent: body.input, conversation: body.conversation }, context);
    if (!result.ok) {
      return NextResponse.json({ error: result.detail, reason: result.reason }, { status: result.reason === "ai_unconfigured" ? 501 : 503 });
    }
    return NextResponse.json({
      interpretation: result.interpretation,
      model: result.model,
      promptVersion: result.promptVersion,
      contextVersion: result.contextVersion,
    });
  } catch (error) {
    return jsonError(error);
  }
}
