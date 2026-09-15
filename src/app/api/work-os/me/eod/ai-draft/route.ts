import { NextResponse } from "next/server";
import { draftEodNarrative, gatherEodGrounding, gatherEodScreenshotContext, refineEodNarrative, sanitizeEodAnnotations } from "@/lib/aiEod";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { createAdminClient } from "@/lib/supabase/admin";
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
    const body = (await req.json().catch(() => ({}))) as { date?: unknown; draft?: unknown; feedback?: unknown; annotations?: unknown };
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    const personId = auth.access.personId as string;
    const personResult = await createAdminClient().from("work_people").select("display_name")
      .eq("organization_id", auth.access.organizationId).eq("id", personId).maybeSingle();
    if (personResult.error) throw new Error(`load person for EOD draft: ${personResult.error.message}`);
    const grounding = await gatherEodGrounding(auth.access.organizationId, personId, date, String(personResult.data?.display_name ?? "The employee"));
    const annotations = sanitizeEodAnnotations(body.annotations);
    const feedback = typeof body.feedback === "string" ? body.feedback : "";
    const hasRefinement = typeof body.draft === "string" || typeof body.feedback === "string" || annotations.length > 0;
    if (hasRefinement) {
      if (typeof body.draft !== "string" || !body.draft.trim() || body.draft.length > 50_000) {
        return NextResponse.json({ error: "draft is required for refinement" }, { status: 400 });
      }
      if (feedback.length > 2_000) {
        return NextResponse.json({ error: "feedback must be 2000 characters or fewer" }, { status: 400 });
      }
      if (feedback.trim().length < 3 && annotations.length === 0) {
        return NextResponse.json({ error: "feedback or annotations are required for refinement" }, { status: 400 });
      }
    }
    if (memoryEnabled(auth.access.featureFlags)) {
      const scope = { organizationId: auth.access.organizationId, personId, localDate: date };
      const [todayBlock, memoryBlock] = await Promise.all([
        buildTodaySnapshot(scope),
        buildMemoryPromptBlock(scope, feedback || "end of day summary of completed and carried work", { limit: 8 }),
      ]);
      grounding.contextBlock = [todayBlock, memoryBlock].filter(Boolean).join("\n\n");
    }
    let screenshots = { processed: 0, excluded: 0, failed: 0, observations: [] as Array<{ capturedAt: string; summary: string; visibleApp: string | null; confidence: number }> };
    let screenshotSyncUnavailable = false;
    try {
      screenshots = await gatherEodScreenshotContext(auth.access.organizationId, personId, date);
    } catch {
      screenshotSyncUnavailable = true;
    }
    const groundingWithObserved = {
      ...grounding,
      observed: screenshots.observations.map((observation) => ({ at: observation.capturedAt, text: observation.summary, app: observation.visibleApp })),
    };
    const result = hasRefinement
      ? await refineEodNarrative(groundingWithObserved, body.draft as string, feedback, annotations)
      : await draftEodNarrative(groundingWithObserved);
    if (!result.ok) {
      const status = result.reason === "ai_unconfigured" ? 501 : 503;
      return NextResponse.json({ error: result.detail ?? "AI EOD drafting unavailable", reason: result.reason }, { status });
    }
    return NextResponse.json({ markdown: result.markdown, model: result.model, screenshots, screenshotSyncUnavailable });
  } catch (error) {
    return jsonError(error);
  }
}
