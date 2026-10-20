import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordWorkMemory, type MemoryScope } from "@/lib/work-memory";
import { localDateForTimezone } from "@/modules/work-os/companion";
import { AI_TIMEOUTS, AI_TOKEN_BUDGETS, aiRequestBody, MEMORY_FACT_MODEL, recordAiUsage } from "@/lib/work-os-ai-model";

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const FACT_TIMEOUT_MS = AI_TIMEOUTS.memoryFact;

export interface FactDraft {
  key: string;
  value: string;
}

const FACT_SCHEMA = {
  name: "work_os_profile_facts",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["facts"],
    properties: {
      facts: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "value"],
          properties: { key: { type: "string" }, value: { type: "string" } },
        },
      },
    },
  },
} as const;

/** Validates and normalizes model-proposed facts. Keys become stable slugs. */
export function normalizeFactDrafts(raw: unknown): FactDraft[] {
  if (!raw || typeof raw !== "object") return [];
  const source = (raw as { facts?: unknown }).facts;
  if (!Array.isArray(source)) return [];
  const drafts: FactDraft[] = [];
  for (const item of source.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { key?: unknown; value?: unknown };
    const key = typeof row.key === "string"
      ? row.key.replace(/[^a-z0-9_]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase().slice(0, 60)
      : "";
    const value = typeof row.value === "string" ? row.value.replace(/\s+/g, " ").trim().slice(0, 240) : "";
    if (!key || value.length < 8) continue;
    drafts.push({ key, value });
  }
  return drafts;
}

export function factSourceId(personId: string, draft: FactDraft): string {
  return createHash("sha256").update(`${personId}:${draft.key}:${draft.value.toLowerCase()}`).digest("hex");
}

/** Proposes candidate profile facts from recent episodic memory. Candidates
 * never reach agent prompts until the employee confirms them. */
export async function extractProfileFactCandidates(
  scope: MemoryScope,
  options: { sinceDays?: number; now?: Date; localDate?: string } = {},
): Promise<{ created: number; considered: number; reason?: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { created: 0, considered: 0, reason: "ai_unconfigured" };
  const db = createAdminClient();
  const now = options.now ?? new Date();
  let candidateLocalDate = typeof options.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.localDate)
    ? options.localDate
    : null;
  if (!candidateLocalDate) {
    const { data: onboarding } = await db
      .from("work_employee_onboarding")
      .select("timezone")
      .eq("organization_id", scope.organizationId)
      .eq("person_id", scope.personId)
      .maybeSingle();
    const timezone = typeof onboarding?.timezone === "string" && onboarding.timezone.trim() ? onboarding.timezone : "UTC";
    candidateLocalDate = localDateForTimezone(now, timezone);
  }
  const since = new Date(now.getTime() - (options.sinceDays ?? 7) * 86_400_000).toISOString();
  const { data: items, error } = await db
    .from("work_memory_items")
    .select("kind,content,summary,local_date,occurred_at")
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .neq("kind", "profile_fact")
    .neq("kind", "digest")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(`load fact sources: ${error.message}`);
  const sources = (items ?? []) as Array<{ kind: string; content: string; summary?: string | null; local_date?: string | null; occurred_at: string }>;
  if (!sources.length) return { created: 0, considered: 0 };

  const { data: existing } = await db
    .from("work_memory_items")
    .select("content")
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("kind", "profile_fact")
    .neq("review_status", "rejected")
    .limit(50);
  const known = ((existing ?? []) as Array<{ content?: unknown }>).map((row) => String(row.content ?? "").toLowerCase()).filter(Boolean);

  const evidence = sources
    .slice(0, 30)
    .map((row) => `- [${row.local_date ?? row.occurred_at.slice(0, 10)}] ${(row.summary || row.content).replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
  const knownList = known.length ? known.slice(0, 30).map((value) => `- ${value}`).join("\n") : "(none)";

  let drafts: FactDraft[] = [];
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(MEMORY_FACT_MODEL, {
        messages: [
          {
            role: "system",
            content: [
              "You extract durable workplace profile facts from an employee's recent work memory.",
              "A fact is a stable preference, working style, recurring constraint, or role context that would help an assistant for weeks.",
              "Never infer performance, quality, completion, productivity, or sensitive personal details. Only include facts directly supported by the evidence.",
              "Skip anything already known. Write each value as one short third-person statement about the employee (for example: 'Prefers deep work before noon.').",
            ].join("\n"),
          },
          { role: "user", content: `Recent work memory:\n${evidence}\n\nAlready known facts:\n${knownList}\n\nReturn JSON {"facts":[{"key":"snake_case_key","value":"..."}]} with 0-8 facts.` },
        ],
        temperature: 0.2,
        max_tokens: AI_TOKEN_BUDGETS.memoryFact,
        response_format: { type: "json_schema", json_schema: FACT_SCHEMA },
      })),
      signal: AbortSignal.timeout(FACT_TIMEOUT_MS),
    });
    if (!response.ok) return { created: 0, considered: sources.length, reason: `provider ${response.status}` };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    recordAiUsage("memory_fact", MEMORY_FACT_MODEL, payload);
    const content = payload.choices?.[0]?.message?.content ?? "";
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return { created: 0, considered: sources.length, reason: "malformed response" };
    drafts = normalizeFactDrafts(JSON.parse(content.slice(start, end + 1)));
  } catch (error) {
    return { created: 0, considered: sources.length, reason: error instanceof Error ? error.message : "provider call failed" };
  }

  let created = 0;
  for (const draft of drafts) {
    const lower = draft.value.toLowerCase();
    if (known.some((value) => value.includes(lower))) continue;
    const recorded = await recordWorkMemory(scope, {
      kind: "profile_fact",
      sourceTable: "memory_facts",
      sourceId: factSourceId(scope.personId, draft),
      content: draft.value,
      summary: draft.value,
      metadata: { factKey: draft.key },
      factKey: draft.key,
      reviewStatus: "candidate",
      localDate: candidateLocalDate,
    });
    if (recorded) {
      created += 1;
      known.push(lower);
    }
  }
  return { created, considered: sources.length };
}

/** Runner entry point: proposes candidates for people with fresh memory. */
export async function extractRecentProfileFacts(limit = 5): Promise<{ people: number; created: number }> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await db
    .from("work_memory_items")
    .select("organization_id,person_id")
    .neq("kind", "profile_fact")
    .neq("kind", "digest")
    .gte("occurred_at", since)
    .limit(200);
  if (error) throw new Error(`load fact scopes: ${error.message}`);
  const scopes = new Map<string, MemoryScope>();
  for (const row of data ?? []) {
    const scope = { organizationId: String(row.organization_id), personId: String(row.person_id) };
    scopes.set(`${scope.organizationId}:${scope.personId}`, scope);
  }
  let created = 0;
  let people = 0;
  for (const scope of [...scopes.values()].slice(0, limit)) {
    const result = await extractProfileFactCandidates(scope, { sinceDays: 3 });
    if (result.created) created += result.created;
    people += 1;
  }
  return { people, created };
}
