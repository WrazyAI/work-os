import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordWorkMemory, type MemoryScope } from "@/lib/work-memory";
import { isPromptReminderContent, memoryScopeKey, conversationTurnFromHistory } from "@/lib/work-memory-core";

export interface ConversationScope extends MemoryScope {
  localDate: string;
}

export interface ConversationTurnInput {
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

function conversationScopeKey(scope: ConversationScope): string {
  return memoryScopeKey(scope.organizationId, scope.personId, scope.localDate);
}

async function conversationId(scope: ConversationScope): Promise<string> {
  const db = createAdminClient();
  const scopeKey = conversationScopeKey(scope);
  const { data: existing, error } = await db
    .from("work_conversations")
    .select("id")
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("scope_key", scopeKey)
    .maybeSingle();
  if (error) throw new Error(`load conversation: ${error.message}`);
  if (existing) return String(existing.id);
  const { data: created, error: createError } = await db
    .from("work_conversations")
    .insert({
      organization_id: scope.organizationId,
      person_id: scope.personId,
      local_date: scope.localDate,
      scope_key: scopeKey,
    })
    .select("id")
    .single();
  if (createError) {
    if (createError.code === "23505") {
      const { data: raced } = await db
        .from("work_conversations")
        .select("id")
        .eq("organization_id", scope.organizationId)
        .eq("person_id", scope.personId)
        .eq("scope_key", scopeKey)
        .maybeSingle();
      if (raced) return String(raced.id);
    }
    throw new Error(`create conversation: ${createError.message}`);
  }
  return String(created.id);
}

/** Appends a turn to the person's per-workday conversation and mirrors it into
 * episodic memory. Idempotent per turn content; never fails the caller. */
export async function appendConversationTurn(scope: ConversationScope, turn: ConversationTurnInput): Promise<{ id: string } | null> {
  const content = turn.content.replace(/\s+/g, " ").trim().slice(0, 8_000);
  if (!content) return null;
  try {
    const db = createAdminClient();
    const id = await conversationId(scope);
    const idempotencyKey = turn.idempotencyKey ?? createHash("sha256").update(`${turn.role}:${content}`).digest("hex");
    const { data, error } = await db
      .from("work_conversation_turns")
      .insert({
        conversation_id: id,
        organization_id: scope.organizationId,
        person_id: scope.personId,
        role: turn.role,
        content,
        metadata: turn.metadata ?? {},
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    let turnId: string | null = null;
    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await db
          .from("work_conversation_turns")
          .select("id")
          .eq("conversation_id", id)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        turnId = existing ? String(existing.id) : null;
      } else {
        throw new Error(error.message);
      }
    } else {
      turnId = String(data.id);
    }
    if (turnId) {
      await recordWorkMemory(scope, {
        kind: "conversation",
        sourceTable: "work_conversation_turns",
        sourceId: turnId,
        content: `${turn.role === "user" ? "Employee" : "Assistant"}: ${content}`,
        localDate: scope.localDate,
        metadata: { role: turn.role },
      });
    }
    return turnId ? { id: turnId } : null;
  } catch (error) {
    console.warn(`conversation turn skipped: ${(error as Error).message}`);
    return null;
  }
}

/** Persists the client-provided interpret history plus the latest input. */
export async function persistInterpretHistory(scope: ConversationScope, history: unknown, latestInput: string): Promise<void> {
  const entries = Array.isArray(history) ? history.slice(-24) : [];
  for (const entry of entries) {
    const turn = conversationTurnFromHistory(entry);
    if (turn) {
      await appendConversationTurn(scope, { role: turn.role, content: turn.content, metadata: { source: "interpret_history" } });
    }
  }
  if (latestInput.trim()) {
    await appendConversationTurn(scope, { role: "user", content: latestInput, metadata: { source: "interpret" } });
  }
}

export async function recentConversationTurns(
  scope: ConversationScope,
  limit = 12,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  try {
    const db = createAdminClient();
    const { data: conversation } = await db
      .from("work_conversations")
      .select("id")
      .eq("organization_id", scope.organizationId)
      .eq("person_id", scope.personId)
      .eq("scope_key", conversationScopeKey(scope))
      .maybeSingle();
    if (!conversation) return [];
    const { data } = await db
      .from("work_conversation_turns")
      .select("role,content,created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 50));
    return (data ?? []).reverse()
      // Never replay reminder scaffolding to the assistant, even if an older
      // client persisted it before the write guard existed.
      .filter((row) => !isPromptReminderContent(String(row.role), String(row.content)))
      .map((row) => ({ role: row.role as "user" | "assistant", content: String(row.content) }));
  } catch (error) {
    console.warn(`conversation history skipped: ${(error as Error).message}`);
    return [];
  }
}
