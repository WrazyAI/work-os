import { canAccessWorkOsPerson, WorkOsConflictError, type WorkOsAccess } from "@/lib/work-os-api";
import { listEvidence, reviewReport } from "@/lib/work-os";
import { resolveDailyWorkspace } from "@/lib/work-os-daily-workspace";
import { addDaysIso } from "@/lib/work-os-dates";
import { audit, dateOnly, db, nonEmptyString as text, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import { recordWorkMemory } from "@/lib/work-memory";
import { localDateForTimezone, localDayBounds, hasScheduledShiftOnDate, type WorkOsScheduleException, type WorkOsScheduleRule } from "@/modules/work-os/companion";
import { listEodScreenshots } from "@/lib/work-os-screenshots";
import { ensureHourlyScreenshotSummaries } from "@/lib/work-os-screenshot-hours";
import { eodActivityWindowFor, withinEodActivityWindow } from "@/lib/work-os-eod-window";
import { eodDraftShiftGate } from "@/lib/work-os-eod-shift-gate";
import { EOD_SHIFT_OPEN_REASON } from "@/lib/work-os-shift-gate";
import { listActivityIntervalActivityLines } from "@/lib/work-os-activity-intervals";
import {
  clipText,
  formatLocalTime,
  formatReportDate,
  groupActivityFrames,
  isAutomationTitle,
  outsideWindowLabel,
} from "@/lib/work-os-eod-facts";
import {
  buildEodReportMarkdown,
  type EodEvidenceFact,
  type EodGhlFacts,
  type EodGithubFacts,
  type EodMediaFact,
  type EodPlanItem,
  type EodRecap,
  type EodReportFacts,
  type EodTaskFact,
} from "@/lib/work-os-eod-report";
import { listGithubActivity } from "@/lib/work-os-github-activity";
import { listGhlActivity, resolveGhlScope } from "@/lib/work-os-ghl-activity";

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

export interface EodLoomContext {
  title: string;
  url: string;
  durationSeconds: number | null;
  digest: string | null;
}

/** The deterministic EOD document. The report is a manager brief plus a
 * complete appendix; no model decides what the day contained. */
export async function buildDailyWorkspaceEodContent(
  access: WorkOsAccess,
  personId: string,
  reportDate: string,
  ownerId: string,
  options: { loom?: EodLoomContext | null } = {},
) {
  const [workspace, personResult, evidenceRows, checkInsResult, eventsResult, timezoneResult, planResult, sessionResult] = await Promise.all([
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
    db().from("work_sessions").select("clocked_in_at,clocked_out_at").eq("organization_id", access.organizationId)
      .eq("person_id", personId).eq("shift_date", reportDate).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (personResult.error) throw new Error(`load EOD person: ${personResult.error.message}`);
  if (checkInsResult.error) throw new Error(`load EOD updates: ${checkInsResult.error.message}`);
  if (eventsResult.error) throw new Error(`load EOD task events: ${eventsResult.error.message}`);
  if (timezoneResult.error) throw new Error(`load EOD timezone: ${timezoneResult.error.message}`);
  if (planResult.error) throw new Error(`load EOD plan: ${planResult.error.message}`);
  if (sessionResult.error) throw new Error(`load EOD session: ${sessionResult.error.message}`);

  const timezone = typeof timezoneResult.data?.timezone === "string" && timezoneResult.data.timezone ? timezoneResult.data.timezone : "UTC";
  const displayName = String(personResult.data?.display_name ?? "The employee");
  const planId = planResult.data?.id ? String(planResult.data.id) : null;

  // The plan's full item list is read for matching only; the report renders
  // outcome mismatches, never the candidate list itself.
  const planRows = planId
    ? await db().from("work_daily_plan_items")
      .select("id,task_id,item_kind,title_snapshot,disposition,completion_state,blocker,rank")
      .eq("plan_id", planId)
    : { data: [], error: null };
  if (planRows.error) throw new Error(`load EOD plan items: ${planRows.error.message}`);
  const planItems: EodPlanItem[] = ((planRows.data ?? []) as Json[]).map((item) => ({
    id: String(item.id ?? ""),
    taskId: item.task_id ? String(item.task_id) : null,
    kind: String(item.item_kind ?? "nifty_task"),
    title: String(item.title_snapshot ?? ""),
    disposition: String(item.disposition ?? "selected"),
    completionState: String(item.completion_state ?? "open"),
    blocker: typeof item.blocker === "string" && item.blocker.trim() ? item.blocker.trim() : null,
  }));

  const evidence = (evidenceRows ?? []) as Json[];
  const updates = (checkInsResult.data ?? []) as Json[];
  const events = (eventsResult.data ?? []) as Json[];
  const dayWork = selectDayEodWork({ events, tasks: workspace.tasks });
  const window = await eodActivityWindowFor(access.organizationId, personId, reportDate);

  const taskById = new Map<string, Json>();
  for (const task of workspace.tasks) taskById.set(String(task.id ?? ""), task);
  // The workspace page is capped at 50 tasks; a busy day can complete more.
  // Resolve the project for every fact task so the brief never loses context
  // just because the task fell outside the page.
  const factTaskIds = [...new Set(
    [...dayWork.completed, ...dayWork.carried, ...dayWork.deferred]
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id)),
  )];
  if (factTaskIds.length) {
    const factTasks = await db().from("work_tasks")
      .select("id,project:work_projects(name)")
      .eq("organization_id", access.organizationId)
      .in("id", factTaskIds)
      .limit(250);
    if (factTasks.error) throw new Error(`load EOD task projects: ${factTasks.error.message}`);
    for (const task of (factTasks.data ?? []) as Json[]) taskById.set(String(task.id ?? ""), task);
  }
  const projectOf = (taskId: string): string | null => {
    const project = taskById.get(taskId)?.project as { name?: unknown } | Array<{ name?: unknown }> | null | undefined;
    const name = Array.isArray(project) ? project[0]?.name : project?.name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  };
  const exactProvenance = new Set(["nifty_exact", "migration_exact", "employee_explicit"]);
  const factOf = (item: EodSectionItem): EodTaskFact => ({
    id: item.id,
    title: item.title,
    project: projectOf(item.id),
    at: item.at,
    exact: exactProvenance.has(String(item.provenance ?? "")),
    outsideLabel: item.at && window && !withinEodActivityWindow(item.at, window) ? outsideWindowLabel(window) || null : null,
  });

  const completedFacts = dayWork.completed.filter((item) => !isAutomationTitle(item.title)).map(factOf);
  const carriedFacts = [...dayWork.carried, ...dayWork.deferred].filter((item) => !isAutomationTitle(item.title)).map(factOf);
  const automation = dayWork.completed.filter((item) => isAutomationTitle(item.title)).map((item) => ({
    title: item.title,
    outside: Boolean(item.at && window && !withinEodActivityWindow(item.at, window)),
  }));

  const blockers = [...new Set(updates
    .filter((update) => String(update.update_kind ?? "") === "blocked")
    .map((update) => clipText(String(update.input_text ?? ""), 240))
    .filter(Boolean))];

  const gallery = await listEodScreenshots(access.organizationId, personId, reportDate, timezone);
  const activityHours = await ensureHourlyScreenshotSummaries({
    organizationId: access.organizationId,
    personId,
    date: reportDate,
    timezone,
  });
  const intervalLines = await listActivityIntervalActivityLines(access.organizationId, personId, reportDate).catch(() => []);
  const coveredHours = new Set(intervalLines.flatMap((line) => line.hourStarts));
  const uncoveredHours = activityHours.filter((hour) => !coveredHours.has(hour.hourStart));
  const recaps: EodRecap[] = intervalLines.map((line) => ({
    label: line.label,
    headline: line.headline,
    detail: line.detail,
    provenance: String(line.provenance ?? "inferred"),
    startIso: line.startIso,
    endIso: line.endIso,
  }));
  const fallbackGroups = uncoveredHours.length ? [] : groupActivityFrames(gallery.viewable);
  const hourly = uncoveredHours.length
    ? uncoveredHours.map((hour) => ({ label: hour.label, summary: hour.summary }))
    : fallbackGroups.map((group) => {
      const first = formatLocalTime(group.firstAt, timezone);
      const last = formatLocalTime(group.lastAt, timezone);
      const range = first && last ? (first === last ? first : `${first}–${last}`) : "time not recorded";
      return { label: `${group.app} · ${range}`, summary: `${group.count} frame${group.count === 1 ? "" : "s"}: ${group.highlights.join("; ")}` };
    });

  let github: EodGithubFacts | null = null;
  if (access.featureFlags.github_evidence === true) {
    try {
      const bounds = window ? { startIso: window.startIso, endIso: window.endIso } : localDayBounds(reportDate, timezone);
      const activity = await listGithubActivity({
        organizationId: access.organizationId,
        personId,
        windowStart: bounds.startIso,
        windowEnd: bounds.endIso,
      });
      const performed = activity.counts.performed;
      const triggered = activity.counts.triggered;
      const pullRequests = [...new Set(activity.items
        .filter((item) => item.relation === "performed" && item.kind === "pull_request")
        .map((item) => {
          const match = item.description.match(/#(\d+)/) ?? item.url?.match(/\/pull\/(\d+)/);
          return match ? `${item.repository ?? "pull request"}#${match[1]}` : item.url ?? item.description;
        }))];
      github = {
        performed: { push: performed.push, pullRequest: performed.pull_request, review: performed.review, issue: performed.issue },
        triggered: { workflowRun: triggered.workflow_run, deployment: triggered.deployment, pullRequest: triggered.pull_request, review: triggered.review, issue: triggered.issue },
        commits: activity.counts.commitsPushed,
        pullRequests,
      };
    } catch {
      github = null;
    }
  }

  let ghl: EodGhlFacts | null = null;
  if (access.featureFlags.ghl_evidence === true) {
    try {
      const ghlScope = await resolveGhlScope(access.organizationId);
      if (ghlScope) {
        const bounds = window ? { startIso: window.startIso, endIso: window.endIso } : localDayBounds(reportDate, timezone);
        const activity = await listGhlActivity({
          scope: ghlScope,
          personId,
          from: bounds.startIso,
          through: bounds.endIso,
          includeOrganizationContext: false,
        });
        const performed: Record<string, number> = {};
        for (const item of activity.items.filter((entry) => entry.relation === "performed")) {
          performed[item.kind] = (performed[item.kind] ?? 0) + 1;
        }
        ghl = {
          performed,
          context: activity.items.filter((item) => item.relation !== "performed").length,
          coverage: activity.coverage.map((entry) => ({ kind: entry.kind, state: entry.state })),
        };
      }
    } catch {
      ghl = null;
    }
  }

  const media: EodMediaFact[] = [];
  const mediaUrls = new Set<string>();
  for (const item of evidence) {
    if (String(item.source ?? "") !== "loom") continue;
    const url = typeof item.url === "string" ? item.url : "";
    if (!url || mediaUrls.has(url)) continue;
    mediaUrls.add(url);
    media.push({
      title: String(item.title ?? "Loom recording"),
      url,
      durationSeconds: null,
      digest: typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : null,
    });
  }
  if (options.loom?.url && !mediaUrls.has(options.loom.url)) {
    mediaUrls.add(options.loom.url);
    media.push(options.loom);
  }

  const outputEvidence: EodEvidenceFact[] = evidence
    .filter((item) => String(item.source ?? "") !== "worktivity" && String(item.source ?? "") !== "loom")
    .map((item) => ({
      title: String(item.title ?? "Recorded item"),
      summary: String(item.summary ?? ""),
      url: typeof item.url === "string" ? item.url : null,
      source: String(item.source ?? "manual"),
      taskId: item.task_id ? String(item.task_id) : null,
    }));

  const roleValue = personResult.data?.role_profile as { name?: string } | Array<{ name?: string }> | null;
  const roleName = Array.isArray(roleValue) ? roleValue[0]?.name : roleValue?.name;
  const session = (sessionResult.data ?? {}) as { clocked_in_at?: unknown; clocked_out_at?: unknown };

  const facts: EodReportFacts = {
    date: reportDate,
    personName: displayName,
    timezone,
    roleName: roleName ?? null,
    goal: { text: workspace.goal.text, provenance: workspace.goal.provenance },
    session: {
      clockedInAt: typeof session.clocked_in_at === "string" ? session.clocked_in_at : null,
      clockedOutAt: typeof session.clocked_out_at === "string" ? session.clocked_out_at : null,
    },
    completed: completedFacts,
    carried: carriedFacts,
    automation,
    automationOutsideLabel: outsideWindowLabel(window) || null,
    planItems,
    updates: updates.map((update) => ({ kind: String(update.update_kind ?? "update"), text: String(update.input_text ?? "") })),
    blockers,
    recaps,
    hourly,
    github,
    ghl,
    media,
    evidence: outputEvidence,
  };
  const content = buildEodReportMarkdown(facts);
  const title = `EOD Report: ${displayName} — ${formatReportDate(reportDate)}`;
  return {
    title,
    markdown: content.markdown,
    metrics: content.metrics,
  };
}

async function persistDailyWorkspaceEod(
  access: WorkOsAccess,
  personId: string,
  reportDate: string,
  draftKey: string | null,
  options: { loom?: EodLoomContext | null } = {},
) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const content = await buildDailyWorkspaceEodContent(access, personId, reportDate, ownerId, options);
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

/** Builds the deterministic document without persisting it. Used when a Loom
 * is attached to an existing draft: the recording shapes the markdown the
 * employee reviews, and the submission stores exactly what they approved. */
export async function renderDailyWorkspaceEod(
  access: WorkOsAccess,
  personId: string,
  reportDate: string,
  options: { loom?: EodLoomContext | null } = {},
) {
  const ownerId = await organizationOwnerId(access.organizationId);
  return buildDailyWorkspaceEodContent(access, personId, reportDate, ownerId, options);
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
  // A day that has not ended cannot be described yet: the report would claim
  // a finished shift while the employee is still working.
  const gate = await eodDraftShiftGate(access, personId, reportDate);
  if (gate.blocked) throw new WorkOsConflictError(gate.message, EOD_SHIFT_OPEN_REASON);
  const loom = body.loom && typeof body.loom === "object" ? body.loom as EodLoomContext : null;
  const report = await persistDailyWorkspaceEod(access, personId, reportDate, draftKey, loom ? { loom } : {});
  await saveReportVersion(access, report, "draft", text(report.markdown) ?? "", draftKey);
  await audit(access, "report.drafted", "report", report.id as string, { personId, reportDate: report.report_date });
  return report;
}

/** Deletes an unsubmitted EOD draft. A submitted report is the manager's
 * record and is never removed here; the audit entry keeps the fact that a
 * draft was discarded. */
export async function deleteWorkOsEodDraft(access: WorkOsAccess, personId: string, reportId: string) {
  const { data: report, error: loadError } = await db().from("work_reports")
    .select("id,person_id,kind,status,submitted_at,report_date")
    .eq("organization_id", access.organizationId).eq("id", reportId).maybeSingle();
  if (loadError) throw new Error(`load EOD draft for deletion: ${loadError.message}`);
  if (!report) throw new WorkOsConflictError("That draft no longer exists.");
  if (String(report.kind ?? "") !== "eod") throw new WorkOsConflictError("Only an EOD draft can be deleted here.");
  if (String(report.person_id ?? "") !== personId) throw new WorkOsConflictError("That draft belongs to someone else.");
  if (!["draft", "rejected"].includes(String(report.status ?? "")) || report.submitted_at) {
    throw new WorkOsConflictError("A submitted EOD is already with your manager and cannot be deleted.");
  }
  // The delete is conditional on the same status the read confirmed, so a
  // report submitted in the meantime is never removed.
  const { data: deleted, error: deleteError } = await db().from("work_reports").delete()
    .eq("organization_id", access.organizationId).eq("id", reportId).eq("person_id", personId)
    .in("status", ["draft", "rejected"]).is("submitted_at", null).select("id");
  if (deleteError) throw new Error(`delete EOD draft: ${deleteError.message}`);
  if (!deleted || deleted.length === 0) {
    throw new WorkOsConflictError("That draft was submitted or removed already, so it was not deleted.");
  }
  await audit(access, "report.deleted", "report", reportId, {
    personId,
    kind: "eod",
    reportDate: report.report_date,
  });
  return { deleted: true, reportId };
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
  /** False for a scheduled person's day off. Absent preserves the legacy
   * unscheduled behavior (every recorded day can be outstanding). */
  scheduledDay?: boolean;
};

/** A day only counts as outstanding when something was recorded for it and no
 * submitted report exists; a draft or rejected report keeps the day visible. */
export function classifyOutstandingEodDays(candidates: OutstandingEodCandidate[]): OutstandingEodDay[] {
  return candidates.flatMap((candidate) => {
    if (candidate.scheduledDay === false) return [];
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
  const [sessionsResult, plansResult, reportsResult, eventsResult, schedulesResult, exceptionsResult] = await Promise.all([
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
    db().from("work_schedules").select("*")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("active", true)
      .order("effective_from", { ascending: false }),
    db().from("work_schedule_exceptions").select("*")
      .eq("organization_id", access.organizationId).eq("person_id", personId)
      .gte("exception_date", from).lte("exception_date", through),
  ]);
  for (const [label, result] of [["sessions", sessionsResult], ["plans", plansResult], ["reports", reportsResult], ["events", eventsResult], ["schedules", schedulesResult], ["schedule exceptions", exceptionsResult]] as const) {
    if (result.error) throw new Error(`load outstanding EOD ${label}: ${result.error.message}`);
  }
  const scheduleRules = (schedulesResult.data ?? []) as unknown as WorkOsScheduleRule[];
  const scheduleExceptions = (exceptionsResult.data ?? []) as unknown as WorkOsScheduleException[];
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
      scheduledDay: hasScheduledShiftOnDate(scheduleRules, scheduleExceptions, date),
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
  /* A report can only be submitted after its day has ended or entered the
     final ten-minute EOD window. Without this gate an early morning draft
     could be submitted mid-shift, which also suppresses the day's later
     prompts. */
  const reportDate = dateOnly(report.report_date);
  if (reportDate) {
    const gate = await eodDraftShiftGate(access, String(report.person_id), reportDate);
    if (gate.blocked) throw new WorkOsConflictError(gate.message, EOD_SHIFT_OPEN_REASON);
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
