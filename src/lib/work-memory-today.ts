import { createAdminClient } from "@/lib/supabase/admin";
import type { MemoryScope } from "@/lib/work-memory";

export interface TodaySnapshotInput {
  date: string;
  focus?: string | null;
  intent?: string | null;
  commitments: Array<{ title: string; status: string }>;
  completed: string[];
  deferred: string[];
  updates: Array<{ kind: string; text: string }>;
  session?: { state: string; clockedInAt: string | null; clockedOutAt: string | null } | null;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function timeOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(11, 16);
}

/** Renders the person's live day state (agenda, completions, updates, shift).
 * This is current data, never recalled history or completion inference. */
export function formatTodaySnapshot(input: TodaySnapshotInput): string {
  const lines: string[] = [`Today so far (${input.date}) — live facts:`];
  const focus = input.focus?.trim() || input.intent?.trim();
  if (focus) lines.push(`- Focus: ${clip(focus, 200)}`);
  if (input.commitments.length) {
    lines.push(`- Agenda: ${input.commitments.slice(0, 8).map((item) => `${clip(item.title, 120)} [${item.status}]`).join("; ")}`);
  }
  if (input.completed.length) {
    lines.push(`- Completed today: ${input.completed.slice(0, 10).map((title) => clip(title, 120)).join("; ")}`);
  }
  if (input.deferred.length) {
    lines.push(`- Deferred today: ${input.deferred.slice(0, 10).map((title) => clip(title, 120)).join("; ")}`);
  }
  if (input.updates.length) {
    lines.push("- Recent updates:");
    for (const update of input.updates.slice(0, 4)) {
      lines.push(`  - [${update.kind}] ${clip(update.text, 200)}`);
    }
  }
  if (input.session) {
    const state = input.session.state === "clocked_in" || input.session.state === "active" ? "on shift" : input.session.state;
    const since = timeOf(input.session.clockedInAt);
    const until = timeOf(input.session.clockedOutAt);
    lines.push(`- Shift: ${state}${since ? ` since ${since} UTC` : ""}${until ? `, clocked out ${until} UTC` : ""}`);
  }
  return lines.join("\n");
}

/** Reads the live day state used by updates, check-ins, and EOD drafting. */
export async function buildTodaySnapshot(scope: MemoryScope & { localDate: string }): Promise<string> {
  const db = createAdminClient();
  const { organizationId, personId, localDate } = scope;
  const [planResult, eventsResult, updatesResult, sessionResult] = await Promise.all([
    db
      .from("work_daily_plans")
      .select("freeform_intent,focus_summary,items:work_daily_plan_items(title_snapshot,disposition,completion_state)")
      .eq("organization_id", organizationId)
      .eq("person_id", personId)
      .eq("shift_date", localDate)
      .maybeSingle(),
    db
      .from("work_task_day_events")
      .select("event_type,task_snapshot,observed_at")
      .eq("organization_id", organizationId)
      .eq("person_id", personId)
      .eq("local_date", localDate)
      .in("event_type", ["completed", "deferred"])
      .order("observed_at", { ascending: true }),
    db
      .from("work_check_ins")
      .select("update_kind,input_text,occurred_at")
      .eq("organization_id", organizationId)
      .eq("person_id", personId)
      .eq("shift_date", localDate)
      .eq("substantive", true)
      .order("occurred_at", { ascending: false })
      .limit(4),
    db
      .from("work_sessions")
      .select("state,clocked_in_at,clocked_out_at")
      .eq("organization_id", organizationId)
      .eq("person_id", personId)
      .eq("shift_date", localDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const plan = planResult.data as { freeform_intent?: unknown; focus_summary?: unknown; items?: unknown } | null;
  const commitments = (Array.isArray(plan?.items) ? plan.items : []).flatMap((item) => {
    const row = item as { title_snapshot?: unknown; disposition?: unknown; completion_state?: unknown };
    const title = typeof row.title_snapshot === "string" && row.title_snapshot.trim() ? row.title_snapshot.trim() : null;
    if (!title) return [];
    const status = row.completion_state === "completed" ? "completed" : row.disposition === "deferred" ? "deferred" : "selected";
    return [{ title, status }];
  });

  const completed: string[] = [];
  const deferred: string[] = [];
  for (const event of (eventsResult.data ?? []) as Array<{ event_type?: unknown; task_snapshot?: unknown }>) {
    const snapshot = (event.task_snapshot ?? {}) as { title?: unknown };
    const title = typeof snapshot.title === "string" && snapshot.title.trim() ? snapshot.title.trim() : null;
    if (!title) continue;
    if (event.event_type === "completed") completed.push(title);
    if (event.event_type === "deferred") deferred.push(title);
  }

  const updates = ((updatesResult.data ?? []) as Array<{ update_kind?: unknown; input_text?: unknown }>).flatMap((row) => {
    const text = typeof row.input_text === "string" && row.input_text.trim() ? row.input_text : null;
    return text ? [{ kind: typeof row.update_kind === "string" && row.update_kind ? row.update_kind : "update", text }] : [];
  });

  const session = sessionResult.data as { state?: unknown; clocked_in_at?: unknown; clocked_out_at?: unknown } | null;
  return formatTodaySnapshot({
    date: localDate,
    focus: typeof plan?.focus_summary === "string" ? plan.focus_summary : null,
    intent: typeof plan?.freeform_intent === "string" ? plan.freeform_intent : null,
    commitments,
    completed,
    deferred,
    updates,
    session: session
      ? {
          state: typeof session.state === "string" ? session.state : "unknown",
          clockedInAt: typeof session.clocked_in_at === "string" ? session.clocked_in_at : session.clocked_in_at instanceof Date ? session.clocked_in_at.toISOString() : null,
          clockedOutAt: typeof session.clocked_out_at === "string" ? session.clocked_out_at : session.clocked_out_at instanceof Date ? session.clocked_out_at.toISOString() : null,
        }
      : null,
  });
}
