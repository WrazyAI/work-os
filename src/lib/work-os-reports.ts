import { todayIso as today } from "@/lib/work-os-dates";
import {
  dateOnly,
  db,
  ensureNoError,
  nonEmptyString,
  selectFirst,
  type Json,
} from "@/lib/work-os-internal";
import { listEvidence } from "@/lib/work-os-evidence-log";
import { listTasks } from "@/lib/work-os-tasks";

export async function createEodReport(userId: string, body: Json) {
  const reportDate = dateOnly(nonEmptyString(body.date)) ?? today();
  const personId = nonEmptyString(body.person_id);
  if (!personId) throw new Error("person_id is required");
  const supabase = db();
  const person = await ensureNoError(
    supabase.from("work_people").select("*, role_profile:work_role_profiles(*)").eq("user_id", userId).eq("id", personId).maybeSingle(),
    "load report person",
  ) as Json | null;
  if (!person) throw new Error("Person not found");

  const tasks = await listTasks(userId, { personId });
  const dayTasks = (tasks as Json[]).filter((task) => {
    const due = dateOnly(task.due_date);
    const completedAt = dateOnly(task.completed_at);
    return due === reportDate || (completedAt !== null && completedAt === reportDate) || (!task.completed && (!due || due <= reportDate));
  });
  const evidence = await listEvidence(userId, { personId, date: reportDate }) as Json[];
  const evidenceClass = (item: Json) => (item.metrics as Json | undefined)?.evidenceClass;
  const substantiveEvidence = evidence.filter((item) => item.source !== "worktivity" && evidenceClass(item) !== "activity_observation");
  const taskEvidenceIds = new Set(substantiveEvidence.map((e) => e.task_id).filter(Boolean));
  const missing = dayTasks.filter((task) => !task.completed && !taskEvidenceIds.has(task.id)).map((task) => ({
    taskId: task.id,
    title: task.title,
    reason: "Open or due task has no evidence for the report date.",
  }));
  const completed = dayTasks.filter((task) => task.completed).length;
  const open = dayTasks.length - completed;
  const activityEvidence = evidence.filter((item) => item.source === "worktivity" || evidenceClass(item) === "activity_observation");
  const outputEvidence = evidence.filter((item) =>
    evidenceClass(item) === "output_evidence" || (!!item.url && evidenceClass(item) !== "activity_observation"),
  );
  const workClaims = evidence.filter((item) => !activityEvidence.includes(item) && !outputEvidence.includes(item));
  const completedTasks = dayTasks.filter((task) => task.completed);
  const openTasks = dayTasks.filter((task) => !task.completed);
  const blockedTasks = dayTasks.filter((task) => task.blocked || task.blocked_reason);
  const title = `EOD Report: ${person.display_name} - ${reportDate}`;
  const role = person.role_profile as Json | null;
  const markdown = [
    `# ${title}`,
    "",
    `Role profile: ${role?.name ?? "Unmapped"}`,
    "",
    "## Summary",
    `- Tasks reviewed: ${dayTasks.length}`,
    `- Completed: ${completed}`,
    `- Still open / needs follow-up: ${open}`,
    `- Evidence records: ${evidence.length}`,
    "",
    "## Completed Work",
    ...(completedTasks.length ? completedTasks.map((task) => `- ${task.title}`) : ["- No completed tasks matched this report date."]),
    "",
    "## Progress On Open Tasks",
    ...(openTasks.length ? openTasks.map((task) => `- ${task.title}`) : ["- No open tasks matched this report date."]),
    ...(workClaims.length ? workClaims.map((item) => `- Employee update: ${item.title}: ${item.summary}`) : []),
    "",
    "## Output Evidence",
    ...(outputEvidence.length ? outputEvidence.map((item) => `- ${item.title}: ${item.summary}`) : ["- No output evidence recorded for this date."]),
    "",
    "## Activity Evidence",
    ...(activityEvidence.length ? activityEvidence.map((item) => `- ${item.title}: ${item.summary}`) : ["- No Worktivity activity evidence synced for this date."]),
    "",
    "## Blockers And Dependencies",
    ...(blockedTasks.length ? blockedTasks.map((task) => `- ${task.title}: ${task.blocked_reason || "Blocked"}`) : ["- No blockers recorded."]),
    "",
    "## Missing Or Ambiguous Evidence",
    ...(missing.length ? missing.map((item) => `- ${item.title}: ${item.reason}`) : ["- No missing evidence detected."]),
    "",
    "## Needs Manager Review",
    ...(missing.length || blockedTasks.length ? ["- Review the missing evidence and blockers listed above."] : ["- No specific review flags were generated."]),
  ].join("\n");

  return selectFirst(
    supabase.from("work_reports").insert({
      user_id: userId,
      person_id: personId,
      report_date: reportDate,
      kind: "eod",
      status: "draft",
      title,
      markdown,
      metrics: { taskCount: dayTasks.length, completed, open, evidenceCount: evidence.length },
      missing_evidence: missing,
      draft_idempotency_key: nonEmptyString(body.draft_idempotency_key),
    }).select("*"),
    "create EOD report",
  );
}

export async function listReports(userId: string) {
  return ensureNoError(
    db().from("work_reports").select("*, person:work_people(id, display_name)").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
    "load reports",
  );
}

export async function reviewReport(userId: string, reportId: string, reviewerId: string, body: Json) {
  const action = nonEmptyString(body.status);
  if (action !== "approved" && action !== "rejected") throw new Error("status must be approved or rejected");
  const patch: Json = {
    status: action,
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (typeof body.markdown === "string") patch.markdown = body.markdown;
  if (typeof body.manager_notes === "string") patch.manager_notes = body.manager_notes;
  const rows = await ensureNoError(
    db().from("work_reports").update(patch).eq("user_id", userId).eq("id", reportId).eq("status", "pending_review").select("*"),
    "review report",
  );
  if (!rows?.[0]) throw new Error("report is no longer pending review");
  return rows[0];
}
