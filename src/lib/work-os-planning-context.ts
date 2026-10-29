import { listPersonTasks } from "@/lib/work-os";
import { workOsOrganizationOwnerId, type WorkOsAccess } from "@/lib/work-os-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateOnly } from "@/lib/work-os-internal";

type Json = Record<string, unknown>;

export type PlanningTask = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: string | null;
  blockedReason: string | null;
};

export type PlanningContext = {
  date: string;
  todayTasks: PlanningTask[];
  carryOver: PlanningTask[];
  previousPlan: { summary: string | null; intent: string | null; openItems: string[] } | null;
  activeBlockers: Array<{ id: string; description: string; taskId: string }>;
  recentUpdates: string[];
  githubEvidence?: Array<{ title: string; summary: string | null; url: string | null; date: string }>;
};

const db = () => createAdminClient();
const asText = (value: unknown, max = 1_000) => typeof value === "string" && value.trim()
  ? value.trim().slice(0, max)
  : null;

function taskContext(rows: Json[]): PlanningTask[] {
  return rows
    .filter((row) => typeof row.id === "string" && typeof row.title === "string")
    .slice(0, 30)
    .map((row) => ({
      id: row.id as string,
      title: row.title as string,
      description: asText(row.description),
      dueDate: dateOnly(row.due_date),
      status: asText(row.status, 120),
      blockedReason: asText(row.blocked_reason),
    }));
}

/** Bounded, employee-scoped context for an explicitly requested planning turn. */
export async function buildPlanningContext(access: WorkOsAccess, date: string): Promise<PlanningContext> {
  const ownerId = workOsOrganizationOwnerId(access);
  const personId = access.personId as string;
  const tasks = await listPersonTasks(ownerId, personId, { completed: "false", includeLedgerHistory: true, limit: 200, includeAssignedBy: false }) as Json[];
  const githubFrom = new Date(`${date}T12:00:00Z`);
  githubFrom.setUTCDate(githubFrom.getUTCDate() - 14);
  const [previousPlanResult, blockerResult, updateResult, githubResult] = await Promise.all([
    db().from("work_daily_plans").select("focus_summary,freeform_intent,items:work_daily_plan_items(title_snapshot,completion_state,disposition)")
      .eq("organization_id", access.organizationId).eq("person_id", personId).lt("shift_date", date)
      .order("shift_date", { ascending: false }).limit(1).maybeSingle(),
    db().from("work_task_blockers").select("id,description,task_id")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("status", "active").limit(12),
    db().from("work_check_ins").select("input_text")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("shift_date", date)
      .order("created_at", { ascending: false }).limit(8),
    // GitHub is optional context, never a completion source. Bound it to recent
    // employee-attributed evidence so old activity cannot steer today's plan.
    db().from("work_evidence").select("title,summary,url,evidence_date")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("source", "github")
      .gte("evidence_date", githubFrom.toISOString().slice(0, 10)).lte("evidence_date", date)
      .order("evidence_date", { ascending: false }).limit(8),
  ]);
  if (previousPlanResult.error) throw new Error(`load previous planning context: ${previousPlanResult.error.message}`);
  if (blockerResult.error) throw new Error(`load planning blockers: ${blockerResult.error.message}`);
  if (updateResult.error) throw new Error(`load recent planning updates: ${updateResult.error.message}`);

  const openTasks = taskContext(tasks);
  const todayTasks = openTasks.filter((task) => task.dueDate === date).slice(0, 20);
  const carryOver = openTasks.filter((task) => task.dueDate !== null && task.dueDate < date).slice(0, 20);
  const previousItems = Array.isArray(previousPlanResult.data?.items) ? previousPlanResult.data.items as Json[] : [];
  const previousPlan = previousPlanResult.data ? {
    summary: asText(previousPlanResult.data.focus_summary, 500),
    intent: asText(previousPlanResult.data.freeform_intent, 1_000),
    openItems: previousItems
      .filter((item) => item.disposition !== "removed" && item.completion_state !== "completed")
      .map((item) => asText(item.title_snapshot, 240)).filter((item): item is string => !!item).slice(0, 12),
  } : null;

  return {
    date,
    todayTasks,
    carryOver,
    previousPlan,
    activeBlockers: (blockerResult.data ?? []).flatMap((row: Json) => {
      const id = asText(row.id, 120);
      const description = asText(row.description);
      const taskId = asText(row.task_id, 120);
      return id && description && taskId ? [{ id, description, taskId }] : [];
    }),
    recentUpdates: (updateResult.data ?? []).map((row: Json) => asText(row.input_text, 600)).filter((item): item is string => !!item),
    githubEvidence: (githubResult.data ?? []).flatMap((row: Json) => {
      const title = asText(row.title, 240);
      const evidenceDate = dateOnly(row.evidence_date);
      if (!title || !evidenceDate) return [];
      return [{ title, summary: asText(row.summary, 600), url: asText(row.url, 1_000), date: evidenceDate }];
    }),
  };
}
