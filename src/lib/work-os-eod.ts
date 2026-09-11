import { canAccessWorkOsPerson, type WorkOsAccess } from "@/lib/work-os-api";
import { listEvidence, reviewReport } from "@/lib/work-os";
import { resolveDailyWorkspace } from "@/lib/work-os-daily-workspace";
import { audit, db, nonEmptyString as text, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import { recordWorkMemory } from "@/lib/work-memory";

function dateOnly(value: unknown) {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

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

async function createDailyWorkspaceEod(access: WorkOsAccess, personId: string, body: Json) {
  const reportDate = dateOnly(body.date) ?? new Date().toISOString().slice(0, 10);
  const ownerId = await organizationOwnerId(access.organizationId);
  const [workspace, personResult, evidenceRows, checkInsResult, eventsResult] = await Promise.all([
    resolveDailyWorkspace(access, reportDate, { limit: 100 }),
    db().from("work_people").select("display_name,role_profile:work_role_profiles(name)")
      .eq("organization_id", access.organizationId).eq("id", personId).single(),
    listEvidence(ownerId, { personId, date: reportDate }),
    db().from("work_check_ins").select("id,input_text,update_kind,substantive").eq("organization_id", access.organizationId)
      .eq("person_id", personId).eq("shift_date", reportDate).eq("substantive", true),
    db().from("work_task_day_events").select("id,event_type,task_snapshot").eq("organization_id", access.organizationId)
      .eq("person_id", personId).eq("local_date", reportDate),
  ]);
  if (personResult.error) throw new Error(`load EOD person: ${personResult.error.message}`);
  if (checkInsResult.error) throw new Error(`load EOD updates: ${checkInsResult.error.message}`);
  if (eventsResult.error) throw new Error(`load EOD task events: ${eventsResult.error.message}`);
  const evidence = (evidenceRows ?? []) as Json[];
  const updates = (checkInsResult.data ?? []) as Json[];
  const events = (eventsResult.data ?? []) as Json[];
  const completed = workspace.tasks.filter((task) => task.completed);
  const progressed = updates.filter((item) => ["continuing", "material_progress"].includes(String(item.update_kind)));
  const deferred = events.filter((item) => item.event_type === "deferred");
  const carried = workspace.carryOverGroups.flatMap((group) => group.tasks);
  const unplanned = workspace.tasks.filter((task) => task.dayAttribution.reason === "creation_observed" && !task.due_date);
  const outputEvidence = evidence.filter((item) => item.source !== "worktivity");
  const activityEvidence = evidence.filter((item) => item.source === "worktivity");
  const roleValue = personResult.data.role_profile as { name?: string } | Array<{ name?: string }> | null;
  const roleName = Array.isArray(roleValue) ? roleValue[0]?.name : roleValue?.name;
  const title = `EOD Report: ${personResult.data.display_name} - ${reportDate}`;
  const lineItems = (items: Json[], empty: string) => items.length ? items.map((item) => `- ${item.title ?? (item.task_snapshot as Json | undefined)?.title ?? item.input_text}`) : [`- ${empty}`];
  const markdown = [
    `# ${title}`,
    "",
    `Role profile: ${roleName ?? "Unmapped"}`,
    `Goal: ${workspace.goal.text ?? "No goal was recorded."}`,
    `Goal provenance: ${workspace.goal.provenance ?? "none"}`,
    workspace.sessionQuality.status === "needs_correction" ? `Session quality: ${workspace.sessionQuality.message}` : "Session quality: valid or not applicable",
    "",
    "## Completed Work",
    ...lineItems(completed, "No completed Nifty tasks were attributed to this date."),
    "",
    "## Progressed Work",
    ...lineItems(progressed, "No substantive progress updates were recorded."),
    "",
    "## Deferred Work",
    ...lineItems(deferred, "No work was explicitly deferred."),
    "",
    "## Carried Work",
    ...lineItems(carried, "No overdue carry-over remained."),
    "",
    "## Unplanned Work",
    ...lineItems(unplanned, "No unplanned task creation was observed."),
    "",
    "## Output Evidence",
    ...lineItems(outputEvidence, "No output evidence was recorded."),
    "",
    "## Activity Context",
    ...lineItems(activityEvidence, "No Worktivity activity context was recorded."),
    "",
    "Activity context is descriptive and does not prove attendance, productivity, or task completion.",
  ].join("\n");
  const { data, error } = await db().from("work_reports").insert({
    user_id: ownerId,
    organization_id: access.organizationId,
    person_id: personId,
    report_date: reportDate,
    kind: "eod",
    status: "draft",
    title,
    markdown,
    metrics: { completed: completed.length, progressed: progressed.length, deferred: deferred.length, carried: carried.length, unplanned: unplanned.length },
    missing_evidence: [],
    draft_idempotency_key: text(body.draft_idempotency_key),
  }).select("*").single();
  if (error) throw new Error(`create daily workspace EOD: ${error.message}`);
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
  let report: Json;
  try {
    report = await createDailyWorkspaceEod(access, personId, body);
  } catch (error) {
    if (!draftKey) throw error;
    const { data: reconciled } = await db().from("work_reports").select("*")
      .eq("organization_id", access.organizationId).eq("draft_idempotency_key", draftKey).maybeSingle();
    if (!reconciled) throw error;
    report = reconciled as Json;
  }
  await saveReportVersion(access, report, "draft", text(report.markdown) ?? "", draftKey);
  await audit(access, "report.drafted", "report", report.id as string, { personId, reportDate: report.report_date });
  return report;
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
