import { NextResponse } from "next/server";
import { refinePlanDraft } from "@/lib/aiPlan";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { buildPlanningContext } from "@/lib/work-os-planning-context";
import { issueDailyPlanBuild } from "@/lib/work-os-plan-build";

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
    const body = await req.json() as { input?: unknown; date?: unknown; draft?: unknown; annotations?: unknown; edits?: unknown };
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    const date = body.date;
    const context = await buildPlanningContext(auth.access, date);
    const result = await refinePlanDraft({ rawIntent: body.input, draft: body.draft, annotations: body.annotations, edits: body.edits }, context);
    if (!result.ok) {
      const status = result.reason === "ai_unconfigured" ? 501 : result.reason === "ai_malformed" ? 400 : 503;
      return NextResponse.json({ error: result.detail, reason: result.reason }, { status });
    }
    const buildId = await issueDailyPlanBuild(auth.access, date, result.interpretation.rawIntent);
    return NextResponse.json({
      interpretation: result.interpretation,
      build_id: buildId,
      model: result.model,
      promptVersion: result.promptVersion,
      contextVersion: result.contextVersion,
    });
  } catch (error) {
    return jsonError(error);
  }
}
