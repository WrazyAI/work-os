import { createAdminClient } from "@/lib/supabase/admin";
import { getPool } from "@/lib/db/pool";
import {
  embedMemoryTexts,
  memoryEmbeddingConfigured,
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_PROVIDER,
} from "@/lib/cohere-embeddings";
import {
  formatMemoryContext,
  fuseMemoryRanks,
  memoryContentHash,
  type MemoryItem,
  type ScoredMemoryItem,
  type WorkMemoryKind,
} from "@/lib/work-memory-core";

export interface MemoryScope {
  organizationId: string;
  personId: string;
}

export interface RecordMemoryInput {
  kind: WorkMemoryKind;
  sourceTable: string;
  sourceId: string;
  content: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  localDate?: string | null;
  consentPurpose?: string | null;
}

export interface RecallOptions {
  kinds?: WorkMemoryKind[];
  from?: string;
  to?: string;
  limit?: number;
}

export interface RecallResult {
  items: ScoredMemoryItem[];
  profileFacts: MemoryItem[];
  vectorUsed: boolean;
}

const MEMORY_ITEM_COLUMNS = "id,kind,content,summary,occurred_at,local_date,source_table,source_id";

/** Best-effort episodic write: never fails the caller's primary workflow.
 * Content is hash-deduplicated; embedding happens asynchronously in the drain. */
export async function recordWorkMemory(scope: MemoryScope, input: RecordMemoryInput): Promise<{ id: string } | null> {
  const content = input.content.replace(/\s+/g, " ").trim().slice(0, 8_000);
  if (!content) return null;
  try {
    const db = createAdminClient();
    const contentHash = memoryContentHash(content);
    const { data, error } = await db
      .from("work_memory_items")
      .insert({
        organization_id: scope.organizationId,
        person_id: scope.personId,
        kind: input.kind,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        local_date: input.localDate ?? null,
        source_table: input.sourceTable,
        source_id: input.sourceId,
        content,
        summary: input.summary ?? null,
        metadata: input.metadata ?? {},
        content_hash: contentHash,
        consent_purpose: input.consentPurpose ?? null,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return null;
      throw new Error(error.message);
    }
    await db.from("work_memory_jobs").upsert(
      {
        organization_id: scope.organizationId,
        person_id: scope.personId,
        kind: input.kind,
        source_table: input.sourceTable,
        source_id: input.sourceId,
        payload: {},
      },
      { onConflict: "organization_id,source_table,source_id", ignoreDuplicates: true },
    );
    return { id: String(data.id) };
  } catch (error) {
    console.warn(`work memory record skipped: ${(error as Error).message}`);
    return null;
  }
}

export interface MemoryDrainResult {
  claimed: number;
  embedded: number;
  failed: number;
}

/** Embeds pending memory items. Called by the agent-runner; idempotent and
 * safe to re-run (only rows with a null embedding are processed). */
export async function drainWorkMemoryJobs(limit = 5): Promise<MemoryDrainResult> {
  const result: MemoryDrainResult = { claimed: 0, embedded: 0, failed: 0 };
  if (!memoryEmbeddingConfigured()) return result;
  const db = createAdminClient();
  const { data: jobs, error } = await db
    .from("work_memory_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`load memory jobs: ${error.message}`);

  for (const job of jobs ?? []) {
    result.claimed += 1;
    const jobId = String(job.id);
    const attempts = Number(job.attempts ?? 0) + 1;
    await db
      .from("work_memory_jobs")
      .update({ status: "processing", attempts, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    try {
      const { data: items, error: itemError } = await db
        .from("work_memory_items")
        .select("id,content")
        .eq("organization_id", String(job.organization_id))
        .eq("person_id", String(job.person_id))
        .eq("source_table", String(job.source_table))
        .eq("source_id", String(job.source_id))
        .is("embedding", null);
      if (itemError) throw new Error(itemError.message);
      const pending = (items ?? []) as { id: string; content: string }[];
      if (pending.length) {
        const { embeddings } = await embedMemoryTexts(pending.map((item) => item.content), "search_document");
        for (let index = 0; index < pending.length; index += 1) {
          const updated = await getPool().query(
            "update work_memory_items set embedding = $1::vector, embedding_provider = $2, embedding_model = $3 where id = $4",
            [`[${embeddings[index].join(",")}]`, MEMORY_EMBEDDING_PROVIDER, MEMORY_EMBEDDING_MODEL, pending[index].id],
          );
          if (updated.rowCount !== 1) throw new Error("memory item embedding update affected no rows");
          result.embedded += 1;
        }
      }
      await db
        .from("work_memory_jobs")
        .update({ status: "done", last_error: null, updated_at: new Date().toISOString() })
        .eq("id", jobId);
    } catch (error) {
      const failed = attempts >= 3;
      result.failed += 1;
      await db
        .from("work_memory_jobs")
        .update({
          status: failed ? "failed" : "pending",
          last_error: (error as Error).message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }
  }
  return result;
}

/** Hybrid recall: vector + lexical candidates fused with recency decay.
 * Degrades to lexical-only when embeddings are not configured reachable. */
export async function recallWorkMemory(scope: MemoryScope, query: string, options: RecallOptions = {}): Promise<RecallResult> {
  const db = createAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 25);
  const candidateLimit = Math.max(limit * 3, 24);
  const kinds = options.kinds?.length ? options.kinds : null;

  const { data: facts } = await db
    .from("work_memory_items")
    .select(MEMORY_ITEM_COLUMNS)
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("kind", "profile_fact")
    .order("occurred_at", { ascending: false })
    .limit(12);
  const profileFacts = (facts ?? []) as MemoryItem[];

  const trimmed = query.replace(/\s+/g, " ").trim().slice(0, 2_000);
  if (!trimmed) return { items: [], profileFacts, vectorUsed: false };

  let vectorHits: MemoryItem[] = [];
  let vectorUsed = false;
  if (memoryEmbeddingConfigured()) {
    try {
      const { embeddings } = await embedMemoryTexts([trimmed], "search_query");
      const res = await getPool().query(
        `select ${MEMORY_ITEM_COLUMNS}
           from work_memory_items
          where organization_id = $2 and person_id = $3 and embedding is not null
            and ($4::text[] is null or kind = any($4))
            and ($5::timestamptz is null or occurred_at >= $5)
            and ($6::timestamptz is null or occurred_at <= $6)
          order by embedding <=> $1::vector
          limit $7`,
        [`[${embeddings[0].join(",")}]`, scope.organizationId, scope.personId, kinds, options.from ?? null, options.to ?? null, candidateLimit],
      );
      vectorHits = res.rows as MemoryItem[];
      vectorUsed = true;
    } catch (error) {
      console.warn(`work memory vector recall skipped: ${(error as Error).message}`);
    }
  }

  const lexical = await getPool().query(
    `select ${MEMORY_ITEM_COLUMNS}
       from work_memory_items
      where organization_id = $2 and person_id = $3 and search @@ plainto_tsquery('english', $1)
        and ($4::text[] is null or kind = any($4))
        and ($5::timestamptz is null or occurred_at >= $5)
        and ($6::timestamptz is null or occurred_at <= $6)
      order by ts_rank_cd(search, plainto_tsquery('english', $1)) desc
      limit $7`,
    [trimmed, scope.organizationId, scope.personId, kinds, options.from ?? null, options.to ?? null, candidateLimit],
  );

  const items = fuseMemoryRanks({ vector: vectorHits, lexical: lexical.rows as MemoryItem[], limit });
  return { items, profileFacts, vectorUsed };
}

export async function buildMemoryPromptBlock(scope: MemoryScope, query: string, options: RecallOptions = {}): Promise<string> {
  const { items, profileFacts } = await recallWorkMemory(scope, query, options);
  return formatMemoryContext({ items, profileFacts });
}

export function memoryEnabled(featureFlags: Record<string, boolean> = {}): boolean {
  return featureFlags.work_memory === true || process.env.WORK_OS_MEMORY_ENABLED === "true";
}
