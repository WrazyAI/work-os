import { NextResponse } from "next/server";
import { gatherEodGrounding, gatherEodScreenshotContext, refineEodNarrative, sanitizeEodAnnotations } from "@/lib/aiEod";
import { draftWorkOsEod, renderDailyWorkspaceEod, type EodLoomContext } from "@/lib/work-os-eod";
import { intervalProvenanceLabel, listActivityIntervalActivityLines } from "@/lib/work-os-activity-intervals";
import { analyzeLoomForAgent } from "@/lib/aiLoom";
import { formatReportDate } from "@/lib/work-os-eod-facts";
import { eodActivityWindowFor } from "@/lib/work-os-eod-window";
import { eodDraftExists, eodDraftShiftGate } from "@/lib/work-os-eod-shift-gate";
import { EOD_SHIFT_OPEN_REASON } from "@/lib/work-os-shift-gate";
import type { EodScreenshotHour } from "@/lib/work-os-screenshot-hours";
import { loomMetadataEnabled } from "@/lib/work-os-loom";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { loadShiftData } from "@/lib/work-os-internal";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildMemoryPromptBlock, memoryEnabled } from "@/lib/work-memory";
import { buildTodaySnapshot } from "@/lib/work-memory-today";
import { githubObservedLines, listGithubActivity } from "@/lib/work-os-github-activity";
import { formatGhlActivityBlock, listGhlActivity, resolveGhlScope } from "@/lib/work-os-ghl-activity";
import { personTimezone } from "@/lib/work-os-screenshots";
import { localDayBounds } from "@/modules/work-os/companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      cadenceMinutes: req.headers.get("x-work-os-cadence-minutes"),
      firstFollowUpMinutes: req.headers.get("x-work-os-first-follow-up-minutes"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = (await req.json().catch(() => ({}))) as { date?: unknown; draft?: unknown; feedback?: unknown; annotations?: unknown; loom?: unknown };
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    const personId = auth.access.personId as string;
    /* A fresh draft describes a finished day, so an open shift refuses it.
       Refining a draft that already exists stays available: the day being
       refined is already recorded. The exemption needs that stored draft —
       arbitrary draft text is not a refinement. */
    const submittedDraft = typeof body.draft === "string" ? body.draft.trim() : "";
    const isRefinement = submittedDraft.length > 0 && await eodDraftExists(auth.access, personId, date);
    if (!isRefinement) {
      const gate = await eodDraftShiftGate(auth.access, personId, date);
      if (gate.blocked) {
        return NextResponse.json({ error: gate.message, reason: EOD_SHIFT_OPEN_REASON }, { status: 409 });
      }
    }

    // An attached Loom is draft context only: it never files an update or an
    // evidence row, and a recording from another day is refused outright.
    const loomInput = body.loom && typeof body.loom === "object" ? body.loom as { url?: unknown; transcript?: unknown } : null;
    let loom: {
      verdict: string;
      createdAt: string | null;
      createdLocalDate: string | null;
      title: string | null;
      durationSeconds: number | null;
      url: string;
      summary: string | null;
      suggestedTasks: number;
    } | null = null;
    if (loomInput && loomMetadataEnabled(auth.access.featureFlags)) {
      const { timezone } = await loadShiftData(auth.access, personId, new Date());
      const feed = await analyzeLoomForAgent({
        url: typeof loomInput.url === "string" ? loomInput.url : "",
        transcript: typeof loomInput.transcript === "string" ? loomInput.transcript : null,
        targetDate: date,
        timezone,
        existingTaskTitles: [],
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
      const personResult = await createAdminClient().from("work_people").select("display_name")
        .eq("organization_id", auth.access.organizationId).eq("id", personId).maybeSingle();
      if (personResult.error) throw new Error(`load person for EOD draft: ${personResult.error.message}`);
      const grounding = await gatherEodGrounding(auth.access.organizationId, personId, date, String(personResult.data?.display_name ?? "The employee"));
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
      // Attributed GitHub activity is provider-recorded fact; it joins the
      // observed context so the draft can quantify what actually shipped.
      let githubLines: string[] = [];
      if (auth.access.featureFlags.github_evidence === true) {
        try {
          const timezone = await personTimezone(auth.access.organizationId, personId);
          const window = await eodActivityWindowFor(auth.access.organizationId, personId, date);
          const bounds = window ? { startIso: window.startIso, endIso: window.endIso } : localDayBounds(date, timezone);
          const activity = await listGithubActivity({
            organizationId: auth.access.organizationId,
            personId,
            windowStart: bounds.startIso,
            windowEnd: bounds.endIso,
          });
          githubLines = githubObservedLines(activity);
        } catch {
          githubLines = [];
        }
      }
      // GHL reaches the draft on the same terms as the deterministic report and
      // the recaps: only activity the record proves the employee performed is
      // stated as theirs, and the workday window bounds the query.
      let ghlLines: string[] = [];
      if (auth.access.featureFlags.ghl_evidence === true) {
        try {
          const scope = await resolveGhlScope(auth.access.organizationId);
          if (scope) {
            const timezone = await personTimezone(auth.access.organizationId, personId);
            const window = await eodActivityWindowFor(auth.access.organizationId, personId, date);
            const bounds = window ? { startIso: window.startIso, endIso: window.endIso } : localDayBounds(date, timezone);
            const activity = await listGhlActivity({
              scope,
              personId,
              from: bounds.startIso,
              through: bounds.endIso,
              includeOrganizationContext: false,
            });
            const block = formatGhlActivityBlock(activity);
            ghlLines = block ? block.split("\n").filter((line) => line.trim().startsWith("- ")) : [];
          }
        } catch {
          ghlLines = [];
        }
      }
      grounding.observed = [
        ...intervalLines.map((line) => ({
          at: null,
          text: `${line.label} — ${intervalProvenanceLabel(line.provenance)}: ${line.detail}`,
          app: null,
        })),
        ...githubLines.map((text) => ({ at: null, text, app: "GitHub" })),
        ...ghlLines.map((text) => ({ at: null, text, app: "GHL" })),
        ...observedHours.map((hour) => ({ at: null, text: `${hour.label}: ${hour.summary}`, app: null })),
      ];
      const result = await refineEodNarrative(grounding, body.draft as string, feedback, annotations);
      if (!result.ok) {
        const status = result.reason === "ai_unconfigured" ? 501 : 503;
        return NextResponse.json({ error: result.detail ?? "AI EOD drafting unavailable", reason: result.reason }, { status });
      }
      return NextResponse.json({ markdown: result.markdown, model: result.model, screenshots, screenshotSyncUnavailable, loom });
    }

    // The initial draft is deterministic. A Loom reshapes the same document;
    // it never asks a model to decide what the day contained.
    let screenshots = { processed: 0, excluded: 0, failed: 0, pending: 0, hours: [] as EodScreenshotHour[] };
    let screenshotSyncUnavailable = false;
    try {
      screenshots = await gatherEodScreenshotContext(auth.access.organizationId, personId, date);
    } catch {
      screenshotSyncUnavailable = true;
    }
    const loomContext: EodLoomContext | null = loom
      ? {
          title: loom.title ?? "Loom recording",
          url: loom.url,
          durationSeconds: loom.durationSeconds,
          digest: loom.summary,
        }
      : null;
    const existing = await createAdminClient().from("work_reports")
      .select("markdown")
      .eq("organization_id", auth.access.organizationId)
      .eq("person_id", personId)
      .eq("kind", "eod")
      .eq("report_date", date)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(`load EOD draft: ${existing.error.message}`);
    const existingMarkdown = String(existing.data?.markdown ?? "");
    // An older client may still ask for a "draft" from the AI route. It gets
    // the deterministic document, and a legacy markdown draft is rebuilt once
    // so the page always opens on the current brief/full-record contract.
    const currentContract = existingMarkdown.includes("## Full record");
    const markdown = loomContext
      ? (await renderDailyWorkspaceEod(auth.access, personId, date, { loom: loomContext })).markdown
      : existingMarkdown && currentContract
        ? existingMarkdown
        : String((await draftWorkOsEod(auth.access, personId, { date })).markdown ?? "");
    return NextResponse.json({ markdown, model: "work-os-eod", screenshots, screenshotSyncUnavailable, loom });
  } catch (error) {
    return jsonError(error);
  }
}
