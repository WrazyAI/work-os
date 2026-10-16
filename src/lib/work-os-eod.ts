import { canAccessWorkOsPerson, WorkOsConflictError, type WorkOsAccess } from "@/lib/work-os-api";
import { listEvidence, reviewReport } from "@/lib/work-os";
import { resolveDailyWorkspace } from "@/lib/work-os-daily-workspace";
import { addDaysIso } from "@/lib/work-os-dates";
import { audit, dateOnly, db, nonEmptyString as text, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import { recordWorkMemory } from "@/lib/work-memory";
import { localDateForTimezone, zonedDateTimeToUtc } from "@/modules/work-os/companion";
import { listEodScreenshots } from "@/lib/work-os-screenshots";
import { ensureHourlyScreenshotSummaries } from "@/lib/work-os-screenshot-hours";
import { eodActivityWindowFor } from "@/lib/work-os-eod-window";
import { intervalProvenanceLabel, listActivityIntervalActivityLines } from "@/lib/work-os-activity-intervals";
import {
  clipText,
  collapseAutomation,
  factLine,
  formatLocalTime,
  formatReportDate,
  groupActivityFrames,
  humanizeGoalSource,
  isAutomationTitle,
  progressedFacts,
  unplannedFacts,
} from "@/lib/work-os-eod-facts";

async function saveReportVersion(access: WorkOsAccess, report: Json, kind: "draft" | "employee_submission" | "manager_edit", markdown: string, idempotencyKey?: string | null) {
  const payload = {
    organization_id: access.organizationId,
    report_id: report.id,
    version_kind: kind,
    markdown,
    metrics: report.metrics ?? {},
    missing_evidence: report.missing_evidence ?? [],
    idempotency_key: idempotencyKey ?? null,
    created_by: access.ctx.user.id,
  };
  const query = idempotencyKey
    ? db().from("work_report_versions").upsert(payload, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true })
    : db().from("work_report_versions").insert(payload);
  const { error } = await query;
  if (error) throw new Error(`save ${kind} EOD version: ${error.message}`);
}

export type EodSectionItem = { id: string; title: string; provenance: string | null; at: string | null };

/** Day-scoped EOD facts. Completed and deferred work comes from the day's own
 * events; carried work is only what the day itself surfaced, deferred, or left
 * due — never the employee's whole overdue backlog. */
export function selectDayEodWork(input: { events: Json[]; tasks: Json[] }): { completed: EodSectionItem[]; deferred: EodSectionItem[]; carried: EodSectionItem[] } {
  const titleOf = (value: unknown) => {
    const title = String((value as Json | null)?.title ?? "").trim();
    return title || null;
  };
  const atOf = (event: Json) => {
    const value = event.exact_at ?? event.observed_at;
    return value instanceof Date ? value.toISOString() : (typeof value === "string" ? value : null);
  };
  const collect = (eventType: "completed" | "deferred") => {
    const byTask = new Map<string, EodSectionItem>();
    for (const event of input.events) {
      if (String(event.event_type ?? "") !== eventType) continue;
      const title = titleOf(event.task_snapshot);
      if (!title) continue;
      const id = String(event.task_id ?? `${title}:${event.id ?? ""}`);
      const provenance = typeof event.provenance === "string" ? event.provenance : null;
      const at = atOf(event);
      const existing = byTask.get(id);
      if (!existing || (provenance === "nifty_exact" && existing.provenance !== "nifty_exact")) byTask.set(id, { id, title, provenance, at });
    }
    return [...byTask.values()];
  };
  const carriedByTask = new Map<string, EodSectionItem>();
  for (const event of input.events) {
    if (String(event.event_type ?? "") !== "carried") continue;
    const title = titleOf(event.task_snapshot);
    if (!title) continue;
    const id = String(event.task_id ?? `${title}:${event.id ?? ""}`);
    carriedByTask.set(id, { id, title, provenance: typeof event.provenance === "string" ? event.provenance : null, at: atOf(event) });
  }
  for (const task of input.tasks) {
    if (task.completed === true) continue;
    const id = String(task.id ?? task.provider_task_id ?? "");
    if (!id || carriedByTask.has(id)) continue;
    const attribution = task.dayAttribution as { reason?: unknown } | null | undefined;
    const reason = String(attribution?.reason ?? "");
    const dueDate = dateOnly(task.due_date);
    const carriedForward = reason === "carried" || task.dayDisposition === "deferred" || (reason === "due_date" && !!dueDate);
    if (!carriedForward) continue;
    carriedByTask.set(id, { id, title: titleOf(task) ?? "Untitled task", provenance: null, at: null });
  }
  return { completed: collect("completed"), deferred: collect("deferred"), carried: [...carriedByTask.values()] };
}

const EOD_SECTION_LIMIT = 25;

function limitedSection(items: Array<Record<string, any>>): Json[] {
  return items.length > EOD_SECTION_LIMIT
    ? [...items.slice(0, EOD_SECTION_LIMIT), { id: "more", title: `…and ${items.length - EOD_SECTION_LIMIT} more (see the full record)` }]
    : items;
}

/** One report line per item: evidence keeps its neutral summary so screenshot
 * observations are readable in the deterministic draft, not just their title. */
export function eodLineItems(items: Json[], empty: string): string[] {
  if (!items.length) return [`- ${empty}`];
  return items.map((item) => {
    const title = text(item.title) ?? text((item.task_snapshot as Json | undefined)?.title) ?? text(item.input_text) ?? "Recorded item";
    const summary = text(item.summary);
    return summary && summary !== title ? `- ${title} — ${clipText(summary, 240)}` : `- ${title}`;
  });
}

/** Caps a fact list with an explicit pointer to the full record; the pointer
 * counts toward the limit so a section never renders more than `limit` lines. */
export function capFactLines(lines: string[], limit = EOD_SECTION_LIMIT): string[] {
  if (lines.length <= limit) return lines;
  const visible = lines.slice(0, Math.max(1, limit - 1));
  return [...visible, `- …and ${lines.length - visible.length} more (see the full record)`];
}

async function buildDailyWorkspaceEodContent(access: WorkOsAccess, personId: string, reportDate: string, ownerId: string) {
  const [workspace, personResult, evidenceRows, checkInsResult, eventsResult, timezoneResult, planResult] = await Promise.all([
    resolveDailyWorkspace(access, reportDate, { limit: 100 }),
    db().from("work_people").select("display_name,role_profile:work_role_profiles(name)")
      .eq("organization_id", access.organizationId).eq("id", personId).single(),
    listEvidence(ownerId, { personId, date: reportDate }),
    db().from("work_check_ins").select("id,input_text,update_kind,substantive,occurred_at").eq("organization_id", access.organizationId)
      .eq("person_id", personId).eq("shift_date", reportDate).eq("substantive", true),
    db().from("work_task_day_events").select("id,task_id,event_type,provenance,task_snapshot,exact_at,observed_at").eq("organization_id", access.organizationId)
      .eq("person_id", personId).eq("local_date", reportDate),
    db().from("work_employee_onboarding").select("timezone").eq("organization_id", access.organizationId)
      .eq("person_id", personId).maybeSingle(),
    db().from("work_daily_plans").select("id").eq("organization_id", access.organizationId)
      .eq("person_id", personId).eq("shift_date", reportDate).maybeSingle(),
  ]);
  if (personResult.error) throw new Error(`load EOD person: ${personResult.error.message}`);
  if (checkInsResult.error) throw new Error(`load EOD updates: ${checkInsResult.error.message}`);
  if (eventsResult.error) throw new Error(`load EOD task events: ${eventsResult.error.message}`);
  if (timezoneResult.error) throw new Error(`load EOD timezone: ${timezoneResult.error.message}`);
  if (planResult.error) throw new Error(`load EOD plan: ${planResult.error.message}`);
  const timezone = typeof timezoneResult.data?.timezone === "string" && timezoneResult.data.timezone ? timezoneResult.data.timezone : "UTC";
  // The gallery depends on the timezone, so it cannot share the batch above.
  const gallery = await listEodScreenshots(access.organizationId, personId, reportDate, timezone);
  const planId = planResult.data?.id ? String(planResult.data.id) : null;
  const planItems = planId
    ? await db().from("work_daily_plan_items").select("task_id").eq("plan_id", planId)
    : { data: [], error: null };
  if (planItems.error) throw new Error(`load EOD plan items: ${planItems.error.message}`);
  const planTaskIds = new Set(((planItems.data ?? []) as Json[])
    .map((item) => String(item.task_id ?? ""))
    .filter((id) => id && id !== "null"));

  const evidence = (evidenceRows ?? []) as Json[];
  // Task facts stay date-scoped; the workday window only labels the ones that
  // finished outside the shift, so overnight output is never hidden.
  const window = await eodActivityWindowFor(access.organizationId, personId, reportDate);
  const updates = (checkInsResult.data ?? []) as Json[];
  const events = (eventsResult.data ?? []) as Json[];
  const dayWork = selectDayEodWork({ events, tasks: workspace.tasks });

  // Routine runs are automation, not deliverables: they collapse into one
  // line, and they never appear as carried or unplanned work.
  const completedHuman = dayWork.completed.filter((item) => !isAutomationTitle(item.title));
  const automation = collapseAutomation(dayWork.completed);
  const deferred = dayWork.deferred.filter((item) => !isAutomationTitle(item.title));
  const carried = dayWork.carried.filter((item) => !isAutomationTitle(item.title));
  const unplanned = unplannedFacts(events, planTaskIds, timezone);
  const progressed = progressedFacts(updates, timezone);
  const outputEvidence = evidence.filter((item) => item.source !== "worktivity");
  const activityHours = await ensureHourlyScreenshotSummaries({
    organizationId: access.organizationId,
    personId,
    date: reportDate,
    timezone,
  });
  // Employee-reviewed intervals are richer than the one-line rollups; where an
  // interval covers an hour, its provenance-labeled recap replaces that hour's
  // line so the same time window is never described twice.
  const intervalLines = await listActivityIntervalActivityLines(access.organizationId, personId, reportDate).catch(() => []);
  const coveredHours = new Set(intervalLines.flatMap((line) => line.hourStarts));
  const uncoveredHours = activityHours.filter((hour) => !coveredHours.has(hour.hourStart));
  const activityEntries = [
    ...intervalLines.map((line) => ({
      at: Date.parse(line.startIso),
      line: `- ${line.label} — ${intervalProvenanceLabel(line.provenance)}: ${clipText(line.detail, 320)}`,
    })),
    ...uncoveredHours.map((hour) => {
      let at = Number.NaN;
      try {
        at = Date.parse(zonedDateTimeToUtc(reportDate, `${String(hour.hourStart).padStart(2, "0")}:00`, timezone).toISOString());
      } catch {
        at = Number.NaN;
      }
      return { at, line: `- ${hour.label} — ${clipText(hour.summary, 240)}` };
    }),
  ].sort((left, right) => (Number.isFinite(left.at) ? left.at : Number.MAX_SAFE_INTEGER) - (Number.isFinite(right.at) ? right.at : Number.MAX_SAFE_INTEGER));
  const activityContextLines = activityEntries.map((entry) => entry.line);
  // Fallback grouping only when no interval or hourly rollup exists (for
  // example the AI provider is unavailable and no cache was written yet).
  const activityGroups = activityContextLines.length ? [] : groupActivityFrames(gallery.viewable);
  const activityCounts = [
    `${gallery.processed} analyzed`,
    gallery.excludedSensitive > 0 ? `${gallery.excludedSensitive} flagged as sensitive (images deleted)` : "",
    gallery.excludedPolicy > 0 ? `${gallery.excludedPolicy} excluded by your exclusions` : "",
    gallery.unavailable > 0 ? `${gallery.unavailable} unavailable` : "",
    gallery.pending > 0 ? `${gallery.pending} still analyzing` : "",
  ].filter(Boolean).join(" · ");

  const roleValue = personResult.data.role_profile as { name?: string } | Array<{ name?: string }> | null;
  const roleName = Array.isArray(roleValue) ? roleValue[0]?.name : roleValue?.name;
  const title = `EOD Report: ${personResult.data.display_name} — ${formatReportDate(reportDate)}`;
  const completedLines = capFactLines(completedHuman.map((item) => factLine(item, timezone, "completed", window)));
  const markdown = [
    `# ${title}`,
    "",
    `Role profile: ${roleName ?? "Not set"}`,
    `Goal: ${workspace.goal.text ?? "No goal was recorded."}`,
    `Goal source: ${humanizeGoalSource(workspace.goal.provenance)}`,
    ...(workspace.sessionQuality.status === "needs_correction" && workspace.sessionQuality.message
      ? [`Session quality: ${workspace.sessionQuality.message}`]
      : []),
    "",
    "## Completed Work",
    ...(completedLines.length ? completedLines : []),
    ...(automation.line ? [automation.line] : []),
    ...(!completedLines.length && !automation.line ? ["- No tasks were completed on this date."] : []),
    "",
    "## Progressed Work",
    ...(progressed.length
      ? capFactLines(progressed.map((item) => factLine(item, timezone, undefined, window)))
      : ["- No progress updates were recorded for this day."]),
    "",
    "## Deferred Work",
    ...capFactLines(deferred.map((item) => factLine(item, timezone, undefined, window))),
    ...(!deferred.length ? ["- No work was explicitly deferred."] : []),
    "",
    "## Carried Work",
    ...capFactLines(carried.map((item) => factLine(item, timezone, undefined, window))),
    ...(!carried.length ? ["- Nothing carries over from this day."] : []),
    "",
    "## Unplanned Work",
    ...(unplanned.length
      ? capFactLines(unplanned.map((item) => factLine(item, timezone, "created", window)))
      : ["- No tasks were created outside the day's plan."]),
    "",
    "## Output Evidence",
    ...eodLineItems(outputEvidence, "No output artifacts (files, videos, or links) were linked to this day."),
    "",
    "## Activity Context",
    ...(activityContextLines.length
      ? activityContextLines
      : activityGroups.length
        ? activityGroups.map((group) => {
            const first = formatLocalTime(group.firstAt, timezone);
            const last = formatLocalTime(group.lastAt, timezone);
            const range = first && last ? (first === last ? first : `${first}–${last}`) : "time not recorded";
            const highlights = group.highlights.map((summary) => `“${summary}”`).join("; ");
            const more = group.count > group.highlights.length ? ` (+${group.count - group.highlights.length} more)` : "";
            return `- ${group.app} — ${group.count} frame${group.count === 1 ? "" : "s"} (${range}): ${highlights}${more}`;
          })
        : ["- No retained activity context was recorded for this day."]),
    ...(gallery.viewable.length || gallery.pending || gallery.unavailable || gallery.excludedSensitive || gallery.excludedPolicy
      ? [`Activity context: ${activityCounts}.`]
      : []),
    "",
    "Activity context is descriptive and does not prove attendance, productivity, or task completion.",
  ].join("\n");
  return {
    title,
    markdown,
    metrics: {
      completed: completedHuman.length,
      automation: automation.count,
      progressed: progressed.length,
      deferred: deferred.length,
      carried: carried.length,
      unplanned: unplanned.length,
    },
  };
}

async function persistDailyWorkspaceEod(access: WorkOsAccess, personId: string, reportDate: string, draftKey: string | null) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const content = await buildDailyWorkspaceEodContent(access, personId, reportDate, ownerId);
  const { data: existing, error: existingError } = await db().from("work_reports").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", personId).eq("kind", "eod")
    .eq("report_date", reportDate)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existingError) throw new Error(`load existing daily EOD: ${existingError.message}`);
  if (existing) {
    if (!["draft", "rejected"].includes(String(existing.status))) {
      throw new WorkOsConflictError("This day's EOD was already submitted and is read-only unless a manager requests changes.");
    }
    const { data: updated, error: updateError } = await db().from("work_reports").update({
      status: "draft",
      title: content.title,
      markdown: content.markdown,
      metrics: content.metrics,
      missing_evidence: [],
      updated_at: new Date().toISOString(),
      ...(draftKey ? { draft_idempotency_key: draftKey } : {}),
    }).eq("organization_id", access.organizationId).eq("id", existing.id)
      .in("status", ["draft", "rejected"]).select("*").maybeSingle();
    if (updateError) throw new Error(`refresh daily workspace EOD: ${updateError.message}`);
    if (updated) return updated as Json;
    const { data: current, error: currentError } = await db().from("work_reports").select("*")
      .eq("organization_id", access.organizationId).eq("id", existing.id).maybeSingle();
    if (currentError) throw new Error(`reload daily workspace EOD: ${currentError.message}`);
    if (current && !["draft", "rejected"].includes(String(current.status))) {
      throw new WorkOsConflictError("This day's EOD was already submitted and is read-only unless a manager requests changes.");
    }
    throw new Error("EOD report changed while it was being drafted");
  }
  const { data, error } = await db().from("work_reports").insert({
    user_id: ownerId,
    organization_id: access.organizationId,
    person_id: personId,
    report_date: reportDate,
    kind: "eod",
    status: "draft",
    title: content.title,
    markdown: content.markdown,
    metrics: content.metrics,
    missing_evidence: [],
    draft_idempotency_key: draftKey,
  }).select("*").single();
  if (error) {
    if (/duplicate key|daily_eod/i.test(error.message)) {
      const { data: raced, error: racedError } = await db().from("work_reports").select("*")
        .eq("organization_id", access.organizationId).eq("person_id", personId).eq("kind", "eod")
        .eq("report_date", reportDate).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (racedError) throw new Error(`reload raced daily EOD: ${racedError.message}`);
      if (raced) return raced as Json;
    }
    throw new Error(`create daily workspace EOD: ${error.message}`);
  }
  return data as Json;
}

export async function draftWorkOsEod(access: WorkOsAccess, personId: string, body: Json) {
  const draftKey = text(body.draft_idempotency_key);
  if (draftKey) {
    const { data: existing, error: existingError } = await db().from("work_reports").select("*")
      .eq("organization_id", access.organizationId).eq("draft_idempotency_key", draftKey).maybeSingle();
    if (existingError) throw new Error(`load idempotent EOD draft: ${existingError.message}`);
    if (existing) {
      await saveReportVersion(access, existing as Json, "draft", text(existing.markdown) ?? "", draftKey);
      return existing;
    }
  }
  const reportDate = dateOnly(body.date) ?? new Date().toISOString().slice(0, 10);
  const report = await persistDailyWorkspaceEod(access, personId, reportDate, draftKey);
  await saveReportVersion(access, report, "draft", text(report.markdown) ?? "", draftKey);
  await audit(access, "report.drafted", "report", report.id as string, { personId, reportDate: report.report_date });
  return report;
}

export type OutstandingEodStatus = "no_draft" | "draft_unsubmitted" | "changes_requested";

export type OutstandingEodDay = {
  date: string;
  status: OutstandingEodStatus;
  reportId: string | null;
  observedMinutes: number;
  completedTasks: number;
  hasPlan: boolean;
};

export type OutstandingEodCandidate = {
  date: string;
  hasSession: boolean;
  observedMinutes: number;
  hasPlan: boolean;
  completedTasks: number;
  report: { id: string; status: string; submitted: boolean } | null;
};

/** A day only counts as outstanding when something was recorded for it and no
 * submitted report exists; a draft or rejected report keeps the day visible. */
export function classifyOutstandingEodDays(candidates: OutstandingEodCandidate[]): OutstandingEodDay[] {
  return candidates.flatMap((candidate) => {
    const report = candidate.report;
    let status: OutstandingEodStatus | null = null;
    if (report?.status === "rejected") status = "changes_requested";
    else if (report && (report.submitted || ["pending_review", "approved"].includes(report.status))) return [];
    else if (report) status = "draft_unsubmitted";
    else if (candidate.hasSession || candidate.hasPlan) status = "no_draft";
    else return [];
    return [{
      date: candidate.date,
      status,
      reportId: report?.id ?? null,
      observedMinutes: candidate.observedMinutes,
      completedTasks: candidate.completedTasks,
      hasPlan: candidate.hasPlan,
    }];
  });
}

const OUTSTANDING_EOD_DEFAULT_DAYS = 14;
const OUTSTANDING_EOD_MAX_DAYS = 31;

function observedSeconds(session: Json) {
  const start = Date.parse(String(session.clocked_in_at ?? ""));
  if (!Number.isFinite(start) || !session.clocked_out_at) return 0;
  const end = Date.parse(String(session.clocked_out_at));
  if (!Number.isFinite(end)) return 0;
  const paused = Number(session.paused_seconds ?? 0) || 0;
  return Math.max(0, Math.round((end - start) / 1000) - paused);
}

async function employeeTimezone(access: WorkOsAccess, personId: string) {
  const { data, error } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", access.organizationId).eq("person_id", personId).maybeSingle();
  if (error) throw new Error(`load employee timezone: ${error.message}`);
  return typeof data?.timezone === "string" && data.timezone.trim() ? data.timezone : "UTC";
}

/** Worked or planned days in the lookback window whose EOD is not submitted.
 * Today is excluded; unresolved past sessions contribute no observed time. */
export async function listOutstandingEods(access: WorkOsAccess, requestedDays = OUTSTANDING_EOD_DEFAULT_DAYS) {
  const personId = access.personId as string;
  const lookback = Number.isFinite(requestedDays)
    ? Math.min(OUTSTANDING_EOD_MAX_DAYS, Math.max(1, Math.floor(requestedDays)))
    : OUTSTANDING_EOD_DEFAULT_DAYS;
  const timezone = await employeeTimezone(access, personId);
  const today = localDateForTimezone(new Date(), timezone);
  const from = addDaysIso(today, -lookback);
  const through = addDaysIso(today, -1);
  const [sessionsResult, plansResult, reportsResult, eventsResult] = await Promise.all([
    db().from("work_sessions").select("shift_date,clocked_in_at,clocked_out_at,paused_seconds,correction_status")
      .eq("organization_id", access.organizationId).eq("person_id", personId)
      .gte("shift_date", from).lte("shift_date", through),
    db().from("work_daily_plans").select("shift_date")
      .eq("organization_id", access.organizationId).eq("person_id", personId)
      .gte("shift_date", from).lte("shift_date", through),
    db().from("work_reports").select("id,report_date,status,submitted_at,created_at")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("kind", "eod")
      .gte("report_date", from).lte("report_date", through),
    db().from("work_task_day_events").select("id,local_date,provider_task_id")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("event_type", "completed")
      .gte("local_date", from).lte("local_date", through),
  ]);
  for (const [label, result] of [["sessions", sessionsResult], ["plans", plansResult], ["reports", reportsResult], ["events", eventsResult]] as const) {
    if (result.error) throw new Error(`load outstanding EOD ${label}: ${result.error.message}`);
  }
  const observedByDate = new Map<string, number>();
  const sessionDates = new Set<string>();
  for (const session of (sessionsResult.data ?? []) as Json[]) {
    const date = dateOnly(session.shift_date);
    if (!date) continue;
    sessionDates.add(date);
    observedByDate.set(date, (observedByDate.get(date) ?? 0) + observedSeconds(session));
  }
  const planDates = new Set<string>();
  for (const plan of (plansResult.data ?? []) as Json[]) {
    const date = dateOnly(plan.shift_date);
    if (date) planDates.add(date);
  }
  const reportByDate = new Map<string, Json>();
  for (const report of (reportsResult.data ?? []) as Json[]) {
    const date = dateOnly(report.report_date);
    if (!date) continue;
    const current = reportByDate.get(date);
    const createdAt = Date.parse(String(report.created_at ?? ""));
    const currentCreatedAt = current ? Date.parse(String(current.created_at ?? "")) : Number.NEGATIVE_INFINITY;
    if (!current || (Number.isFinite(createdAt) && createdAt >= currentCreatedAt)) reportByDate.set(date, report);
  }
  const completedByDate = new Map<string, Set<string>>();
  for (const event of (eventsResult.data ?? []) as Json[]) {
    const date = dateOnly(event.local_date);
    if (!date) continue;
    const key = String(event.provider_task_id ?? event.id);
    const set = completedByDate.get(date) ?? new Set<string>();
    set.add(key);
    completedByDate.set(date, set);
  }
  const candidates: OutstandingEodCandidate[] = [];
  for (let offset = lookback; offset >= 1; offset -= 1) {
    const date = addDaysIso(today, -offset);
    const report = reportByDate.get(date) ?? null;
    candidates.push({
      date,
      hasSession: sessionDates.has(date),
      observedMinutes: Math.round((observedByDate.get(date) ?? 0) / 60),
      hasPlan: planDates.has(date),
      completedTasks: completedByDate.get(date)?.size ?? 0,
      report: report ? { id: String(report.id), status: String(report.status ?? "draft"), submitted: !!report.submitted_at } : null,
    });
  }
  const days = classifyOutstandingEodDays(candidates);
  return { from, through, count: days.length, days };
}

export async function submitWorkOsEod(access: WorkOsAccess, reportId: string, body: Json) {
  const { data: report, error: loadError } = await db()
    .from("work_reports")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("id", reportId)
    .single();
  if (loadError) throw new Error(`load EOD report: ${loadError.message}`);
  if (!report.person_id || !(await canAccessWorkOsPerson(access, String(report.person_id)))) throw new Error("forbidden");
  const submissionKey = text(body.submission_idempotency_key);
  if (submissionKey && report.submission_idempotency_key === submissionKey) {
    await saveReportVersion(access, report as Json, "employee_submission", text(report.submitted_markdown) ?? text(report.markdown) ?? "", submissionKey);
    return report;
  }
  if (!["draft", "rejected"].includes(report.status)) throw new Error("only draft or rejected reports can be submitted");
  const markdown = text(body.markdown) ?? text(report.markdown);
  if (!markdown) throw new Error("markdown is required");
  const submittedAt = new Date().toISOString();
  const { data: submitted, error: submitError } = await db().from("work_reports").update({
    status: "pending_review",
    markdown,
    submitted_markdown: markdown,
    submitted_by: access.ctx.user.id,
    submitted_at: submittedAt,
    submission_idempotency_key: submissionKey,
    reviewed_by: null,
    reviewed_at: null,
    updated_at: submittedAt,
  }).eq("organization_id", access.organizationId).eq("id", reportId).in("status", ["draft", "rejected"]).select("*").maybeSingle();
  if (submitError) throw new Error(`submit EOD report: ${submitError.message}`);
  if (!submitted) {
    const { data: reconciled, error: reconcileError } = await db().from("work_reports").select("*")
      .eq("organization_id", access.organizationId).eq("id", reportId).maybeSingle();
    if (reconcileError || !reconciled || !submissionKey || reconciled.submission_idempotency_key !== submissionKey) {
      throw new Error("EOD report changed while it was being submitted");
    }
    await saveReportVersion(access, reconciled as Json, "employee_submission", text(reconciled.submitted_markdown) ?? markdown, submissionKey);
    return reconciled;
  }
  await saveReportVersion(access, submitted as Json, "employee_submission", markdown, submissionKey);
  await audit(access, "report.submitted", "report", reportId, { personId: report.person_id, submittedAt });
  await recordWorkMemory(
    { organizationId: access.organizationId, personId: String(report.person_id) },
    {
      kind: "eod",
      sourceTable: "work_reports",
      sourceId: reportId,
      content: markdown,
      summary: markdown.replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 200),
      metadata: { reportDate: report.report_date, submittedAt },
      localDate: dateOnly(report.report_date) ?? new Date().toISOString().slice(0, 10),
      occurredAt: submittedAt,
    },
  );
  return submitted;
}

export async function reviewWorkOsEod(access: WorkOsAccess, reportId: string, body: Json) {
  const { data: report, error: loadError } = await db()
    .from("work_reports")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("id", reportId)
    .single();
  if (loadError) throw new Error(`load EOD report for review: ${loadError.message}`);
  if (report.status !== "pending_review") throw new Error("only pending reports can be reviewed");
  // Review integrity: a manager who is also an employee must never approve,
  // reject, or edit their own report. Another reviewer must handle it.
  if (report.person_id === access.personId) throw new Error("You cannot review your own EOD report. Ask another manager to review it.");
  const ownerId = await organizationOwnerId(access.organizationId);
  const reviewed = await reviewReport(ownerId, reportId, access.ctx.user.id, body) as Json;
  if (typeof body.markdown === "string" && body.markdown !== report.markdown) {
    const { error: versionError } = await db().from("work_report_versions").insert({
      organization_id: access.organizationId,
      report_id: reportId,
      version_kind: "manager_edit",
      markdown: body.markdown,
      metrics: report.metrics ?? {},
      missing_evidence: report.missing_evidence ?? [],
      created_by: access.ctx.user.id,
    });
    if (versionError) throw new Error(`save manager EOD edit: ${versionError.message}`);
  }
  await audit(access, `report.${String(body.status)}`, "report", reportId, {
    personId: report.person_id,
    employeeSubmissionPreserved: !!report.submitted_markdown,
  });
  return reviewed;
}
