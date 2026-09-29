import { createHash } from "node:crypto";

export type WorkMemoryKind =
  | "check_in"
  | "plan"
  | "task_event"
  | "evidence"
  | "screenshot"
  | "eod"
  | "conversation"
  | "digest"
  | "profile_fact";

export interface MemoryItem {
  id: string;
  kind: WorkMemoryKind;
  content: string;
  summary?: string | null;
  occurred_at: string;
  local_date?: string | null;
  source_table: string;
  source_id: string;
  similarity?: number | null;
  lexical_rank?: number | null;
}

export interface ScoredMemoryItem extends MemoryItem {
  score: number;
}

export function memoryContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function memoryScopeKey(organizationId: string, personId: string, localDate: string): string {
  return `${organizationId}:${personId}:${localDate}`;
}

/** Normalizes a client history entry. Web sends `content`, the desktop
 * companion sends `text`; both must persist. */
export function conversationTurnFromHistory(entry: unknown): { role: "user" | "assistant"; content: string } | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as { role?: unknown; content?: unknown; text?: unknown };
  const role = raw.role === "user" || raw.role === "assistant" ? raw.role : null;
  const content =
    typeof raw.content === "string" && raw.content.trim()
      ? raw.content
      : typeof raw.text === "string" && raw.text.trim()
        ? raw.text
        : null;
  if (!role || !content) return null;
  return { role, content };
}

const RRF_K = 60;

/** Reciprocal-rank fusion of vector and lexical candidates with recency decay.
 * Deduplicates by memory id; profile facts are handled separately. */
export function fuseMemoryRanks(input: {
  vector: MemoryItem[];
  lexical: MemoryItem[];
  now?: Date;
  halfLifeDays?: number;
  limit?: number;
}): ScoredMemoryItem[] {
  const nowMs = (input.now ?? new Date()).getTime();
  const halfLifeDays = input.halfLifeDays ?? 45;
  const limit = input.limit ?? 12;
  const scores = new Map<string, { item: MemoryItem; score: number }>();
  const add = (item: MemoryItem, rank: number) => {
    const existing = scores.get(item.id);
    const contribution = 1 / (RRF_K + rank);
    if (existing) existing.score += contribution;
    else scores.set(item.id, { item, score: contribution });
  };
  input.vector.forEach((item, index) => add(item, index + 1));
  input.lexical.forEach((item, index) => add(item, index + 1));
  const decayed: ScoredMemoryItem[] = [];
  for (const { item, score } of scores.values()) {
    const ageDays = Math.max(0, (nowMs - new Date(item.occurred_at).getTime()) / 86_400_000);
    decayed.push({ ...item, score: score * Math.pow(0.5, ageDays / halfLifeDays) });
  }
  decayed.sort((a, b) => b.score - a.score);
  return decayed.slice(0, limit);
}

function memoryDate(item: MemoryItem): string {
  return item.local_date || item.occurred_at.slice(0, 10);
}

/** Formats recalled memory as a dated prompt block. Recalled context is
 * explicitly labeled as history, never as current fact. */
export function formatMemoryContext(input: {
  items: MemoryItem[];
  profileFacts?: MemoryItem[];
  sameDayCandidates?: MemoryItem[];
  maxChars?: number;
  perItemChars?: number;
}): string {
  const maxChars = input.maxChars ?? 2_400;
  const perItemChars = input.perItemChars ?? 400;
  const lines: string[] = [];
  const clip = (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > perItemChars ? `${clean.slice(0, perItemChars - 1)}…` : clean;
  };
  let used = 0;
  const push = (line: string) => {
    if (used + line.length + 1 > maxChars) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };
  const tentative = input.sameDayCandidates ?? [];
  if (tentative.length) {
    push("Working context inferred on this date (unconfirmed; use only to understand intent, never as completion evidence or a durable fact):");
    for (const fact of tentative) {
      if (!push(`- [${memoryDate(fact)} · tentative] ${clip(fact.content)}`)) break;
    }
  }
  for (const fact of input.profileFacts ?? []) {
    if (!push(`- Known about this person (${memoryDate(fact)}): ${clip(fact.content)}`)) break;
  }
  const recalled = input.items ?? [];
  if (recalled.length) {
    push("Recalled history (dated context, not current facts):");
    for (const item of recalled) {
      if (!push(`- [${memoryDate(item)} · ${item.kind}] ${clip(item.summary || item.content)}`)) break;
    }
  }
  return lines.join("\n");
}
