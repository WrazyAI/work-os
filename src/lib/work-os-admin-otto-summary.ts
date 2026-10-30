import { AI_TIMEOUTS, aiRequestBody, INTERPRET_MODEL, recordAiUsage } from "@/lib/work-os-ai-model";
import type { AdminRead, PersonRef, ReviewedRecap, WorkRecord } from "@/modules/work-os/admin-otto/contracts";
import type { AdminOttoConversationTurn } from "@/lib/work-os-admin-otto-intent";

/**
 * Writes the grounded reply for an admin read. The typed reader has already
 * run under the administrator's authorization; this pass only turns the
 * bounded result into a short natural answer. It never selects a new tool and
 * never sees an id, URL, private chat, memory, or draft.
 */

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const MAX_REPLY = 1_000;
const MAX_ITEMS = 8;
const MAX_ITEM_TEXT = 500;

export type AdminOttoSummaryDeps = {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  env?: Record<string, string | undefined>;
  now?: Date;
};

const ADMIN_OTTO_SUMMARY_SCHEMA = {
  name: "work_os_admin_otto_reply",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reply"],
    properties: { reply: { type: "string" } },
  },
} as const;

function bounded(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function recapPayload(recap: ReviewedRecap) {
  return {
    person: bounded(recap.person.displayName, 120),
    reviewStatus: recap.reviewStatus,
    reviewedAt: recap.reviewedAt,
    windowStart: recap.windowStart,
    windowEnd: recap.windowEnd,
    headline: bounded(recap.original.headline, MAX_ITEM_TEXT),
    detail: bounded(recap.original.detail, MAX_ITEM_TEXT),
    correction: recap.reviewStatus === "amended" ? bounded(recap.employeeFeedback, MAX_ITEM_TEXT) : null,
  };
}

function recordPayload(record: WorkRecord) {
  return {
    source: record.source,
    date: record.localDate,
    text: bounded(record.text, MAX_ITEM_TEXT),
  };
}

/** A bounded, safe projection of the typed result. No ids or links. */
export function projectAdminOttoRead(read: Exclude<AdminRead, { kind: "resolution" }>) {
  if (read.kind === "tasks") {
    return {
      kind: "tasks",
      total: read.page.total,
      shown: read.page.items.length,
      people: read.people.map((person) => bounded(person.displayName, 120)),
      items: read.page.items.slice(0, MAX_ITEMS).map((task) => ({
        title: bounded(task.title, 300),
        status: task.status,
        dueDate: task.effectiveDueDate,
        assignees: task.assignees.map((person) => bounded(person.displayName, 120)),
      })),
      coverage: read.page.coverage.map((line) => bounded(line, 300)),
    };
  }
  if (read.kind === "records") {
    return {
      kind: "records",
      total: read.page.total,
      shown: read.page.items.length,
      windows: read.windows.map((window) => ({ from: window.from, through: window.through, timezone: window.timezone })),
      items: read.page.items.slice(0, MAX_ITEMS).map(recordPayload),
      coverage: read.page.coverage.map((line) => bounded(line, 300)),
    };
  }
  if (read.kind === "recaps") {
    return {
      kind: "recaps",
      total: read.page.total,
      shown: read.page.items.length,
      items: read.page.items.slice(0, MAX_ITEMS).map(recapPayload),
      coverage: read.page.coverage.map((line) => bounded(line, 300)),
    };
  }
  return { kind: "recap", recap: recapPayload(read.recap) };
}

function conversationBlock(conversation: AdminOttoConversationTurn[] | undefined): string {
  return (conversation ?? [])
    .slice(-8)
    .map((turn) => `${turn.role === "user" ? "Administrator" : "Assistant"}: ${bounded(turn.content, 800)}`)
    .filter((line) => line.length > 14)
    .join("\n");
}

export function buildAdminOttoSummaryPrompt(
  text: string,
  read: Exclude<AdminRead, { kind: "resolution" }>,
  people: PersonRef[],
  conversation: AdminOttoConversationTurn[] | undefined,
  now: Date,
): string {
  const recent = conversationBlock(conversation);
  return [
    "You are Admin Otto, the read-only administration assistant in Work OS. Write the final reply to the administrator's request.",
    "Use ONLY the tool result below. Do not invent names, counts, dates, work, approval, or completion. Do not say you changed, messaged, approved, or ran anything. If the result is empty, say no matching records were found and remind the administrator that a missing record is not proof that no work happened. If records exist, mention the true total and one or two concrete items from the result in 1-3 short sentences. Use the requested record type (tasks, reports, EOD reports, reviewed recaps, or workday). Do not mention ids, URLs, internal field names, SQL, or hidden context.",
    "Write for a busy administrator: plain, direct, and specific. Do not repeat the previous assistant reply verbatim.",
    `Today is ${now.toISOString().slice(0, 10)} (UTC).`,
    people.length ? `Resolved people: ${people.map((person) => bounded(person.displayName, 120)).join(", ")}.` : "",
    recent ? `Recent conversation (context only, never evidence of work):\n${recent}` : "",
    "The administrator asked:",
    `"""${bounded(text, 4_000)}"""`,
    "Tool result (the only allowed evidence):",
    JSON.stringify(projectAdminOttoRead(read)),
  ].filter(Boolean).join("\n");
}

/** Returns null when the summary provider is unavailable; the caller keeps the
 * grounded server reply rather than failing an otherwise successful read. */
export async function summarizeAdminOttoRead(
  text: string,
  read: Exclude<AdminRead, { kind: "resolution" }>,
  people: PersonRef[],
  conversation: AdminOttoConversationTurn[] | undefined,
  deps: AdminOttoSummaryDeps = {},
): Promise<string | null> {
  const env = deps.env ?? process.env;
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  const now = deps.now instanceof Date && !Number.isNaN(deps.now.getTime()) ? deps.now : new Date();
  const fetchImpl = deps.fetch ?? fetch;
  let payload: unknown;
  try {
    const response = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(INTERPRET_MODEL, {
        messages: [
          {
            role: "system",
            content: "You are the Work OS administration assistant. You summarize a completed read-only tool result truthfully and concisely. You never invent data and you output only valid JSON.",
          },
          { role: "user", content: buildAdminOttoSummaryPrompt(text, read, people, conversation, now) },
        ],
        temperature: 0.3,
        max_tokens: 1_200,
        response_format: { type: "json_schema", json_schema: ADMIN_OTTO_SUMMARY_SCHEMA },
      }, env)),
      signal: AbortSignal.timeout(AI_TIMEOUTS.interpret),
    });
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }
  recordAiUsage("admin_otto_reply", INTERPRET_MODEL, payload);
  const content = (payload as { choices?: Array<{ message?: { content?: string } }> } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const reply = (raw as { reply?: unknown }).reply;
  if (typeof reply !== "string") return null;
  const normalized = reply.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return normalized && normalized.length <= MAX_REPLY ? normalized : null;
}
