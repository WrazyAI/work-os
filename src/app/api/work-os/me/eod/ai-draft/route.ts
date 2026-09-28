import { NextResponse } from "next/server";
import { draftEodNarrative, gatherEodGrounding, gatherEodScreenshotContext, refineEodNarrative, sanitizeEodAnnotations } from "@/lib/aiEod";
import { intervalProvenanceLabel, listActivityIntervalActivityLines } from "@/lib/work-os-activity-intervals";
import { analyzeLoomForAgent } from "@/lib/aiLoom";
import { formatReportDate } from "@/lib/work-os-eod-facts";
import type { EodScreenshotHour } from "@/lib/work-os-screenshot-hours";
import { loomMetadataEnabled } from "@/lib/work-os-loom";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { loadShiftData } from "@/lib/work-os-internal";
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
    const body = (await req.json().catch(() => ({}))) as { date?: unknown; draft?: unknown; feedback?: unknown; annotations?: unknown; loom?: unknown };
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    const personId = auth.access.personId as string;
    const personResult = await createAdminClient().from("work_people").select("display_name")
      .eq("organization_id", auth.access.organizationId).eq("id", personId).maybeSingle();
    if (personResult.error) throw new Error(`load person for EOD draft: ${personResult.error.message}`);
    const grounding = await gatherEodGrounding(auth.access.organizationId, personId, date, String(personResult.data?.display_name ?? "The employee"));
    // An attached Loom is draft context only: it never files an update or an
    // evidence row, and a recording from another day is refused outright.
    const loomInput = body.loom && typeof body.loom === "object" ? body.loom as { url?: unknown; transcript?: unknown } : null;
    let loom: { verdict: string; createdAt: string | null; createdLocalDate: string | null; title: string | null; durationSeconds: number | null; url: string; summary: string | null; suggestedTasks: number } | null = null;
    if (loomInput && loomMetadataEnabled(auth.access.featureFlags)) {
      const { timezone } = await loadShiftData(auth.access, personId, new Date());
      const feed = await analyzeLoomForAgent({
        url: typeof loomInput.url === "string" ? loomInput.url : "",
        transcript: typeof loomInput.transcript === "string" ? loomInput.transcript : null,
        targetDate: date,
        timezone,
        existingTaskTitles: grounding.completed,
      });
      if (!feed.bundle) return NextResponse.json({ error: "The Loom link is not a valid Loom share link.", reason: "loom_invalid" }, { status: 400 });
      if (feed.blocked) {
        return NextResponse.json({
          error: `That Loom was recorded ${feed.bundle.temporal.createdLocalDate ? formatReportDate(feed.bundle.temporal.createdLocalDate) : "on an unverified date"}, so it cannot be used for the ${formatReportDate(date)} EOD.`,
          reason: feed.reason === "future" ? "loom_future" : "loom_prior_day",
        }, { status: 409 });
      }
      loom = {
        verdict: feed.bundle.temporal.verdict,
        createdAt: feed.bundle.temporal.createdAt,
        createdLocalDate: feed.bundle.temporal.createdLocalDate,
        title: feed.bundle.metadata?.title ?? null,
        durationSeconds: feed.bundle.metadata?.durationSeconds ?? null,
        url: feed.bundle.reference.url,
        summary: feed.analysis?.summary ?? null,
        suggestedTasks: feed.analysis?.suggestedTasks.length ?? 0,
      };
      grounding.media = [{
        at: new Date().toISOString(),
        title: feed.bundle.metadata?.title ?? "Loom recording",
        url: feed.bundle.reference.url,
        durationSeconds: feed.bundle.metadata?.durationSeconds ?? null,
        digest: feed.analysis?.summary ?? null,
        transcriptChars: feed.bundle.transcript.chars,
      }];
    }
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
    let screenshots = { processed: 0, excluded: 0, failed: 0, pending: 0, hours: [] as EodScreenshotHour[] };
    let screenshotSyncUnavailable = false;
    try {
      screenshots = await gatherEodScreenshotContext(auth.access.organizationId, personId, date);
    } catch {
      screenshotSyncUnavailable = true;
    }
    // Employee-reviewed interval recaps are the stronger activity context;
    // hourly rollups only fill hours an interval does not already cover.
    const intervalLines = await listActivityIntervalActivityLines(auth.access.organizationId, personId, date).catch(() => []);
    const coveredHours = new Set(intervalLines.flatMap((line) => line.hourStarts));
    const observedHours = screenshots.hours.filter((hour) => !coveredHours.has(hour.hourStart));
    const groundingWithObserved = {
      ...grounding,
      observed: [
        ...intervalLines.map((line) => ({
          at: null,
          text: `${line.label} — ${intervalProvenanceLabel(line.provenance)}: ${line.detail}`,
          app: null,
        })),
        ...observedHours.map((hour) => ({ at: null, text: `${hour.label}: ${hour.summary}`, app: null })),
      ],
    };
    const result = hasRefinement
      ? await refineEodNarrative(groundingWithObserved, body.draft as string, feedback, annotations)
      : await draftEodNarrative(groundingWithObserved);
    if (!result.ok) {
      const status = result.reason === "ai_unconfigured" ? 501 : 503;
      return NextResponse.json({ error: result.detail ?? "AI EOD drafting unavailable", reason: result.reason }, { status });
    }
    return NextResponse.json({ markdown: result.markdown, model: result.model, screenshots, screenshotSyncUnavailable, loom });
  } catch (error) {
    return jsonError(error);
  }
}
