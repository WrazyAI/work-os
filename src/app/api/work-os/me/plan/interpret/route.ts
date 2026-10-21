import { NextResponse } from "next/server";
import { interpretDailyPlan, LOOM_ONLY_PLAN_INTENT, type PlanLoomContext, type PlanMemoryContext } from "@/lib/aiPlan";
import { buildLoomAttachment, buildPastedLoomAttachment } from "@/lib/aiLoom";
import { findLoomReference, loomMetadataEnabled } from "@/lib/work-os-loom";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { buildPlanningContext } from "@/lib/work-os-planning-context";
import { issueDailyPlanBuild } from "@/lib/work-os-plan-build";
import { loadShiftData } from "@/lib/work-os-internal";
import { buildMemoryPromptBlock, memoryEnabled } from "@/lib/work-memory";
import { buildTodaySnapshot } from "@/lib/work-memory-today";
import { persistInterpretHistory } from "@/lib/work-conversations";

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
    const body = await req.json() as { input?: unknown; date?: unknown; conversation?: unknown; loom?: unknown };
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    const date = body.date;
    const inputText = typeof body.input === "string" ? body.input : "";
    const context = await buildPlanningContext(auth.access, date);
    let memory: PlanMemoryContext | undefined;
    if (memoryEnabled(auth.access.featureFlags)) {
      const scope = { organizationId: auth.access.organizationId, personId: auth.access.personId as string, localDate: date };
      const [todayBlock, memoryBlock] = await Promise.all([
        buildTodaySnapshot(scope),
        buildMemoryPromptBlock(scope, typeof body.input === "string" ? body.input : "daily plan", { limit: 8 }),
      ]);
      memory = { todayBlock, memoryBlock };
    }
    // A Loom source is either the recording link or a transcript the employee
    // pasted without one. Both are planning context; commitments still come
    // from the normal review flow. Enrichment is optional: schedule/network/AI
    // failures must never block planning.
    let loom: PlanLoomContext | undefined;
    const loomInput = body.loom && typeof body.loom === "object" ? body.loom as { url?: unknown; transcript?: unknown } : null;
    const pastedTranscript = typeof loomInput?.transcript === "string" ? loomInput.transcript : "";
    const loomText = [
      inputText,
      typeof loomInput?.url === "string" ? loomInput.url : "",
      pastedTranscript,
    ].filter(Boolean).join(" ");
    if (loomMetadataEnabled(auth.access.featureFlags)) {
      const reference = findLoomReference(loomText);
      if (reference || pastedTranscript.trim()) {
        try {
          const existingTaskTitles = [...context.todayTasks, ...context.carryOver].map((task) => task.title).slice(0, 60);
          if (reference) {
            const { timezone } = await loadShiftData(auth.access, auth.access.personId as string, new Date());
            const attachment = await buildLoomAttachment({
              text: loomText,
              transcript: pastedTranscript,
              targetDate: date,
              timezone,
              existingTaskTitles,
            });
            if (attachment) loom = { ...attachment.attachment };
          } else {
            const attachment = await buildPastedLoomAttachment({
              transcript: pastedTranscript,
              targetDate: date,
              existingTaskTitles,
            });
            if (attachment) loom = { ...attachment.attachment };
          }
        } catch {
          loom = undefined;
        }
      }
    }
    const planningInput = inputText.trim() || (loom ? LOOM_ONLY_PLAN_INTENT : "");
    const result = await interpretDailyPlan({ rawIntent: planningInput, conversation: body.conversation }, context, memory, loom);
    if (!result.ok) {
      return NextResponse.json({ error: result.detail, reason: result.reason }, { status: result.reason === "ai_unconfigured" ? 501 : 503 });
    }
    await persistInterpretHistory(
      { organizationId: auth.access.organizationId, personId: auth.access.personId as string, localDate: date },
      body.conversation,
      planningInput,
    );
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
