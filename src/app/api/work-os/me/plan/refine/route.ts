import { NextResponse } from "next/server";
import { refinePlanDraft, type PlanMemoryContext } from "@/lib/aiPlan";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { buildPlanningContext } from "@/lib/work-os-planning-context";
import { issueDailyPlanBuild } from "@/lib/work-os-plan-build";
import { buildMemoryPromptBlock, memoryEnabled } from "@/lib/work-memory";
import { buildTodaySnapshot } from "@/lib/work-memory-today";

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
    const body = await req.json() as { input?: unknown; date?: unknown; draft?: unknown; annotations?: unknown; edits?: unknown; clarifications?: unknown; clarificationAnswers?: unknown };
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    const date = body.date;
    const context = await buildPlanningContext(auth.access, date);
    let memory: PlanMemoryContext | undefined;
    if (memoryEnabled(auth.access.featureFlags)) {
      const scope = { organizationId: auth.access.organizationId, personId: auth.access.personId as string, localDate: date };
      const [todayBlock, memoryBlock] = await Promise.all([
        buildTodaySnapshot(scope),
        buildMemoryPromptBlock(scope, typeof body.input === "string" ? body.input : "daily plan refinement", { limit: 8 }),
      ]);
      memory = { todayBlock, memoryBlock };
    }
    const result = await refinePlanDraft({ rawIntent: body.input, draft: body.draft, annotations: body.annotations, edits: body.edits, clarifications: body.clarifications, clarificationAnswers: body.clarificationAnswers }, context, memory);
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
