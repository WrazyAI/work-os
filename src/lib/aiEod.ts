import { createAdminClient } from "@/lib/supabase/admin";

export const EOD_MODEL = process.env.WORK_OS_INTERPRET_MODEL ?? "gpt-5.6-luna";
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const EOD_TIMEOUT_MS = 60_000;

export type EodFailure = "ai_unconfigured" | "ai_unavailable" | "ai_malformed";

export interface EodGrounding {
  date: string;
  personName: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  updates: Array<{ kind: string; text: string; at: string }>;
  completed: string[];
  carried: string[];
  blockers: string[];
}

const BOTTLENECK_PLACEHOLDER = "(needs your input — what prevented you from completing your task list?)";

export function buildEodPrompt(grounding: EodGrounding): string {
  const fmt = (list: string[], empty: string) => list.length ? list.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
  return [
    `Write the end-of-day report for ${grounding.personName}, ${grounding.date}. Plain language for a manager — no jargon, no productivity scores, no invention.`,
    `Session: ${grounding.clockedInAt ?? "not clocked in"} → ${grounding.clockedOutAt ?? "still open"}.`,
    "",
    "Updates recorded through the day:",
    fmt(grounding.updates.map((update) => `[${update.kind}] ${update.text}`), "none"),
    "",
    "Tasks completed today:",
    fmt(grounding.completed, "none"),
    "",
    "Carried over to tomorrow:",
    fmt(grounding.carried, "none"),
    "",
    "Recorded blockers:",
    fmt(grounding.blockers, "none"),
    "",
    "Write ONLY markdown with these sections in order:",
    "## Summary",
    "A 2-4 sentence human narrative of the day based only on the record above.",
    "## Completed",
    "Bullet list from the completed tasks and completion updates.",
    "## Carried forward",
    "Bullet list; say clearly if nothing carried.",
    "## Bottleneck",
    "If blockers were recorded, describe them in one or two sentences. Otherwise write exactly:",
    BOTTLENECK_PLACEHOLDER,
    "Never invent work, numbers, times, or blockers that are not in the record.",
  ].join("\n");
}

/** Guarantees the required bottleneck section exists with an explicit placeholder if the model omitted it. */
export function ensureBottleneckSection(markdown: unknown): string | null {
  if (typeof markdown !== "string" || !markdown.trim()) return null;
  const trimmed = markdown.replace(/\s+$/, "");
  if (/##\s*Bottleneck/i.test(trimmed)) return trimmed;
  return `${trimmed}\n\n## Bottleneck\n${BOTTLENECK_PLACEHOLDER}`;
}

export async function gatherEodGrounding(organizationId: string, personId: string, date: string, personName: string): Promise<EodGrounding> {
  const db = createAdminClient();
  const [updatesResult, eventsResult, sessionResult] = await Promise.all([
    db.from("work_check_ins").select("input_text,update_kind,occurred_at").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("shift_date", date).eq("substantive", true).order("occurred_at", { ascending: true }),
    db.from("work_task_day_events").select("event_type,task_snapshot").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("local_date", date).order("occurred_at", { ascending: true }),
    db.from("work_sessions").select("clocked_in_at,clocked_out_at").eq("organization_id", organizationId)
      .eq("person_id", personId).eq("shift_date", date).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (updatesResult.error) throw new Error(`load EOD updates: ${updatesResult.error.message}`);
  if (eventsResult.error) throw new Error(`load EOD task events: ${eventsResult.error.message}`);

  const updates = ((updatesResult.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({ kind: String(row.update_kind ?? "update"), text: String(row.input_text ?? ""), at: String(row.occurred_at ?? "") }))
    .filter((row) => row.text);
  const completed: string[] = [];
  const carried: string[] = [];
  const blockers: string[] = [];
  for (const event of (eventsResult.data ?? []) as Array<Record<string, unknown>>) {
    const snapshot = (event.task_snapshot ?? {}) as { title?: unknown };
    const title = typeof snapshot.title === "string" && snapshot.title.trim() ? snapshot.title.trim() : "a task";
    if (event.event_type === "completed") completed.push(title);
    if (event.event_type === "deferred") carried.push(title);
  }
  for (const update of updates) {
    if (update.kind === "blocked" && !blockers.includes(update.text)) blockers.push(update.text);
  }
  const session = (sessionResult.data ?? {}) as { clocked_in_at?: unknown; clocked_out_at?: unknown };
  return {
    date,
    personName,
    clockedInAt: typeof session.clocked_in_at === "string" ? session.clocked_in_at : null,
    clockedOutAt: typeof session.clocked_out_at === "string" ? session.clocked_out_at : null,
    updates,
    completed,
    carried,
    blockers,
  };
}

export interface EodDraftResult {
  ok: boolean;
  markdown?: string;
  model?: string;
  reason?: EodFailure;
  detail?: string;
}

export async function draftEodNarrative(grounding: EodGrounding): Promise<EodDraftResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "ai_unconfigured", detail: "OPENROUTER_API_KEY is not set on the server" };
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EOD_MODEL,
        messages: [
          { role: "system", content: "You are the Work OS assistant. You write honest, plain-language end-of-day reports strictly from the recorded facts. You never invent work, times, or blockers. You output only markdown." },
          { role: "user", content: buildEodPrompt(grounding) },
        ],
        temperature: 0.3,
        max_tokens: 1400,
      }),
      signal: AbortSignal.timeout(EOD_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "ai_unavailable", detail: `provider responded ${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const markdown = ensureBottleneckSection(payload.choices?.[0]?.message?.content);
    if (!markdown) return { ok: false, reason: "ai_malformed", detail: "empty narrative" };
    return { ok: true, markdown, model: EOD_MODEL };
  } catch (error) {
    return { ok: false, reason: "ai_unavailable", detail: error instanceof Error ? error.message : "provider call failed" };
  }
}
