/** The goal a day receives when its first recap comes due without one.
 *
 * The employee is asked first: the goal question holds the day's prompt until
 * a goal exists. When the hold expires, this writes the fallback that keeps the
 * recap, the dashboard, and the EOD describing the same focus. It is written
 * once, marked `suggested`, and never claims the employee wrote it.
 *
 * The suggestion is deliberately small: one sentence from three bounded
 * sources — unfinished work carried from earlier days, work created or due
 * today, and the interval's recorded activity — with a small token budget and
 * no tools. Any failure returns null and leaves the recap goal-less rather
 * than blocking it. */

import { workOsOrganizationOwnerId, type WorkOsAccess } from "@/lib/work-os-api";
import { audit, dateOnly, db, type Json } from "@/lib/work-os-internal";
import { listPersonTasks } from "@/lib/work-os";

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const GOAL_MODEL = process.env.WORK_OS_GOAL_SUGGESTION_MODEL
  ?? process.env.WORK_OS_PLAN_MODEL
  ?? process.env.WORK_OS_INTERPRET_MODEL
  ?? "gpt-5.6-luna";
const GOAL_TIMEOUT_MS = 15_000;
export const MAX_GOAL_CHARS = 160;

export type GoalSuggestionContext = {
  date: string;
  /** Unfinished tasks carried from earlier days. */
  priorOpen: string[];
  /** Tasks created today, whatever their due date. */
  createdToday: string[];
  /** Open tasks due today. */
  dueToday: string[];
  /** Bounded observed activity from the interval that is due. */
  activity: string[];
};

function taskLines(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`) : ["- None recorded."];
}

export function buildGoalSuggestionPrompt(context: GoalSuggestionContext): string {
  return [
    "Write one short sentence naming the most useful focus for the rest of this workday.",
    `Use only the unfinished work and observed activity below. Do not claim completion, effort, or quality, and do not invent tasks. At most ${MAX_GOAL_CHARS} characters.`,
    'Return only JSON: {"goal": "..."}.',
    "",
    "Unfinished work from earlier days:",
    ...taskLines(context.priorOpen),
    "",
    "Work created or due today:",
    ...taskLines([...context.createdToday, ...context.dueToday]),
    "",
    "Observed activity in this interval:",
    ...taskLines(context.activity),
  ].join("\n");
}

/** The model's goal, trimmed to one bounded sentence. Anything else is null. */
export function parseGoalSuggestion(raw: unknown): string | null {
  const value = raw && typeof raw === "object" ? (raw as { goal?: unknown }).goal : null;
  if (typeof value !== "string") return null;
  const goal = value.replace(/\s+/g, " ").trim();
  if (!goal) return null;
  return goal.slice(0, MAX_GOAL_CHARS);
}

type SuggestionTask = { id: string; title: string; due: string | null; created: string | null };

function suggestionTasks(rows: Json[]): SuggestionTask[] {
  return rows.flatMap((row) => {
    const id = typeof row.id === "string" ? row.id : "";
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 240) : "";
    if (!id || !title) return [];
    return [{
      id,
      title,
      due: dateOnly(row.due_date),
      created: dateOnly(row.provider_created_at ?? row.created_at),
    }];
  });
}

/** Writes the suggested goal for one day when it still has none. Returns the
 * goal that was written, or null when the day already has one, the model is
 * unavailable, or the write lost a race. */
export async function suggestWorkOsDayGoal(
  access: WorkOsAccess,
  input: { date: string; activity?: string[] },
): Promise<{ goal: string; taskIds: string[] } | null> {
  const personId = access.personId as string;
  const { data: plan, error: planError } = await db().from("work_daily_plans")
    .select("id,focus_summary,freeform_intent")
    .eq("organization_id", access.organizationId).eq("person_id", personId).eq("shift_date", input.date)
    .maybeSingle();
  if (planError) throw new Error(`load daily plan for goal suggestion: ${planError.message}`);
  if (!plan) return null;
  const existing = [plan.focus_summary, plan.freeform_intent]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .find(Boolean);
  if (existing) return null;

  const rows = await listPersonTasks(workOsOrganizationOwnerId(access), personId, { completed: "false", includeLedgerHistory: true, limit: 200 }) as Json[];
  const open = suggestionTasks(rows);
  const priorOpen = open.filter((task) => task.due !== null && task.due < input.date).slice(0, 12);
  const createdToday = open.filter((task) => task.created === input.date).slice(0, 10);
  const dueToday = open.filter((task) => task.due === input.date).slice(0, 10);
  const context: GoalSuggestionContext = {
    date: input.date,
    priorOpen: priorOpen.map((task) => task.title),
    createdToday: createdToday.map((task) => task.title),
    dueToday: dueToday.map((task) => task.title),
    activity: (input.activity ?? []).slice(0, 12),
  };

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  let goal: string | null = null;
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GOAL_MODEL,
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          { role: "system", content: "You are the Work OS planning assistant. Return only valid JSON and do not perform mutations." },
          { role: "user", content: buildGoalSuggestionPrompt(context) },
        ],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(GOAL_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    goal = parseGoalSuggestion(JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"));
  } catch {
    return null;
  }
  if (!goal) return null;

  // The write is conditional on the goal still being empty, so an employee who
  // typed one while the model was running keeps theirs.
  const taskIds = [...new Set([...priorOpen, ...createdToday, ...dueToday].map((task) => task.id))];
  const { data: updated, error: updateError } = await db().from("work_daily_plans").update({
    focus_summary: goal,
    goal_provenance: "suggested",
    suggestion_task_ids: taskIds,
    updated_at: new Date().toISOString(),
  }).eq("organization_id", access.organizationId).eq("id", plan.id as string)
    .is("focus_summary", null).select("id").maybeSingle();
  if (updateError) throw new Error(`save suggested goal: ${updateError.message}`);
  if (!updated) return null;
  await audit(access, "plan.goal_suggested", "daily_plan", plan.id as string, {
    goal,
    model: GOAL_MODEL,
    source: "activity_interval",
    taskIds,
  });
  return { goal, taskIds };
}
