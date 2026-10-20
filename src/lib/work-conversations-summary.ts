import { createAdminClient } from "@/lib/supabase/admin";
import { AI_TIMEOUTS, AI_TOKEN_BUDGETS, CONVERSATION_SUMMARY_MODEL, aiRequestBody, recordAiUsage } from "@/lib/work-os-ai-model";
import { conversationScopeKey, type ConversationScope } from "@/lib/work-conversations";

/**
 * A per-workday chat keeps only its most recent turns in the prompt, so the
 * assistant forgets the start of a long day. This folds the turns that fall
 * out of that window into one running summary, stored beside the conversation.
 *
 * The summary is conversation context, never evidence: it records what was
 * discussed and decided, and it must not be read as proof that work happened.
 */

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
export const CONVERSATION_SUMMARY_PROMPT_VERSION = "work-conversation-summary-v1";

/** Turns kept verbatim in the prompt. The reader asks for the same number, so
 * folding never leaves a turn that is neither sent nor summarized. */
export const CONVERSATION_VERBATIM_TURNS = 8;

/** Fold only once this many turns sit unfolded. Below it, the window already
 * carries the whole conversation and a fold would cost a call for nothing. */
export const CONVERSATION_FOLD_THRESHOLD = 12;

const MAX_SUMMARY_CHARS = 1_500;
const MAX_TURN_CHARS = 900;

const SUMMARY_SYSTEM_PROMPT = [
  "You keep a running summary of one employee's chat with the Work OS assistant.",
  "Record only what the conversation itself says: questions asked, topics covered, decisions made, and anything the employee said they intend to do.",
  "Never state that work was completed, shipped, or verified because it was mentioned in conversation, and never treat the conversation as evidence of progress.",
  "Write short third-person notes, at most 150 words, and merge the existing summary with the new turns instead of appending a second summary.",
  "When the new turns add nothing, return the existing summary unchanged.",
].join("\n");

export type ConversationSummaryResult =
  | { folded: 0; reason: "not_due" | "empty" | "unavailable" | "unchanged" | "unconfigured" }
  | { folded: number; summaryChars: number; model: string };

function db() {
  return createAdminClient();
}

/** The conversation plus its running summary. Turns the summary covers are
 * dropped from the verbatim list, so nothing is sent twice. */
export async function loadConversationContext(scope: ConversationScope, limit = CONVERSATION_VERBATIM_TURNS): Promise<{
  summary: string | null;
  turns: Array<{ role: "user" | "assistant"; content: string }>;
}> {
  const client = db();
  const { data: conversation, error } = await client
    .from("work_conversations")
    .select("id,summary,summarized_through")
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("scope_key", conversationScopeKey(scope))
    .maybeSingle();
  if (error || !conversation) return { summary: null, turns: [] };
  const summarizedThrough = conversation.summarized_through as string | null;
  let query = client
    .from("work_conversation_turns")
    .select("role,content,created_at")
    .eq("conversation_id", conversation.id);
  if (summarizedThrough) query = query.gt("created_at", summarizedThrough);
  const { data } = await query.order("created_at", { ascending: false }).limit(Math.min(Math.max(limit, 1), 50));
  const turns = (data ?? [])
    .reverse()
    .filter((row) => !isPromptReminder(String(row.role), String(row.content)))
    .map((row) => ({ role: row.role as "user" | "assistant", content: String(row.content) }));
  return { summary: typeof conversation.summary === "string" && conversation.summary.trim() ? conversation.summary.trim() : null, turns };
}

/** Mirrors the reader's filter in `recentConversationTurns`: reminder
 * scaffolding is never part of the conversation. */
function isPromptReminder(role: string, content: string) {
  if (role !== "assistant") return false;
  return [
    "What are you working on today?:",
    "First check-in due:",
    "Check-in due:",
    "EOD review is due:",
  ].some((prefix) => content.startsWith(prefix));
}

/**
 * Folds the turns that have fallen out of the verbatim window into the running
 * summary. Best-effort: a provider or database failure leaves the conversation
 * exactly as it was, and never fails the chat turn that triggered it.
 */
export async function foldConversationSummary(scope: ConversationScope): Promise<ConversationSummaryResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { folded: 0, reason: "unconfigured" };

  const client = db();
  const { data: conversation, error: conversationError } = await client
    .from("work_conversations")
    .select("id,summary,summarized_through")
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("scope_key", conversationScopeKey(scope))
    .maybeSingle();
  if (conversationError || !conversation) return { folded: 0, reason: "empty" };

  const summarizedThrough = conversation.summarized_through as string | null;
  let query = client
    .from("work_conversation_turns")
    .select("id,role,content,created_at")
    .eq("conversation_id", conversation.id);
  if (summarizedThrough) query = query.gt("created_at", summarizedThrough);
  const { data: rows, error: turnsError } = await query.order("created_at", { ascending: true }).limit(200);
  if (turnsError) return { folded: 0, reason: "unavailable" };

  const turns = (rows ?? []).filter((row) => !isPromptReminder(String(row.role), String(row.content)));
  if (turns.length <= CONVERSATION_FOLD_THRESHOLD) return { folded: 0, reason: "not_due" };

  const toFold = turns.slice(0, turns.length - CONVERSATION_VERBATIM_TURNS);
  if (!toFold.length) return { folded: 0, reason: "not_due" };

  const transcript = toFold
    .map((turn) => `${turn.role === "user" ? "Employee" : "Assistant"}: ${String(turn.content).replace(/\s+/g, " ").trim().slice(0, MAX_TURN_CHARS)}`)
    .join("\n");
  const previous = typeof conversation.summary === "string" && conversation.summary.trim() ? conversation.summary.trim() : "(none yet)";

  let summary: string;
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(CONVERSATION_SUMMARY_MODEL, {
        messages: [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: `Existing summary:\n${previous}\n\nTurns to fold in:\n${transcript}\n\nReturn only the merged summary.` },
        ],
        temperature: 0.2,
        max_tokens: AI_TOKEN_BUDGETS.conversationSummary,
      })),
      signal: AbortSignal.timeout(AI_TIMEOUTS.conversationSummary),
    });
    if (!response.ok) return { folded: 0, reason: "unavailable" };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    recordAiUsage("conversation_summary", CONVERSATION_SUMMARY_MODEL, payload);
    const content = payload.choices?.[0]?.message?.content ?? "";
    summary = content.replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_SUMMARY_CHARS);
  } catch {
    return { folded: 0, reason: "unavailable" };
  }
  if (!summary) return { folded: 0, reason: "unavailable" };

  // The boundary is the last folded turn's own timestamp, so the reader can
  // tell exactly which turns the summary already covers.
  const boundary = String(toFold[toFold.length - 1].created_at);
  let update = client
    .from("work_conversations")
    .update({ summary, summarized_through: boundary, updated_at: new Date().toISOString() })
    .eq("organization_id", scope.organizationId)
    .eq("id", conversation.id);
  // Optimistic guard: if another turn folded the same span first, this update
  // matches nothing and the newer summary wins.
  update = summarizedThrough ? update.eq("summarized_through", summarizedThrough) : update.is("summarized_through", null);
  const { data: saved, error: saveError } = await update.select("id").maybeSingle();
  if (saveError || !saved) return { folded: 0, reason: "unchanged" };

  return { folded: toFold.length, summaryChars: summary.length, model: CONVERSATION_SUMMARY_MODEL };
}
