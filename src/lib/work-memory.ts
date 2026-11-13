import { createAdminClient } from "@/lib/supabase/admin";
import { isoDate, isoTimestamp } from "@/lib/iso-timestamp";
import { getPool } from "@/lib/db/pool";
import { WorkOsValidationError } from "@/lib/work-os-api";
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
  reviewStatus?: "candidate" | "confirmed" | "rejected";
  factKey?: string | null;
}

export interface RecallOptions {
  kinds?: WorkMemoryKind[];
  from?: string;
  to?: string;
  limit?: number;
  /** Local workday being analyzed. Candidate profile facts are only usable on this date. */
  analysisLocalDate?: string;
  /** Defaults to true when an analysis date is available. */
  includeSameDayCandidates?: boolean;
}

export interface RecallResult {
  items: ScoredMemoryItem[];
  profileFacts: MemoryItem[];
  sameDayCandidates: MemoryItem[];
  vectorUsed: boolean;
}

const MEMORY_ITEM_COLUMNS = "id,kind,content,summary,occurred_at,local_date,source_table,source_id";

function validLocalDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

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
        // Normalise here: a Date or a String(date) would be rejected by
        // Postgres, and the caller only logs a warning.
        occurred_at: isoTimestamp(input.occurredAt) ?? new Date().toISOString(),
        local_date: input.localDate ? isoDate(input.localDate) : null,
        source_table: input.sourceTable,
        source_id: input.sourceId,
        content,
        summary: input.summary ?? null,
        metadata: input.metadata ?? {},
        content_hash: contentHash,
        consent_purpose: input.consentPurpose ?? null,
        review_status: input.reviewStatus ?? "confirmed",
        fact_key: input.factKey ?? null,
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
export async function recallWorkMemory(scope: MemoryScope & { localDate?: string }, query: string, options: RecallOptions = {}): Promise<RecallResult> {
  const db = createAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 25);
  const candidateLimit = Math.max(limit * 3, 24);
  const kinds = options.kinds?.length ? options.kinds : null;
  const analysisLocalDate = validLocalDate(options.analysisLocalDate)
    ? options.analysisLocalDate
    : validLocalDate(scope.localDate)
      ? scope.localDate
      : null;

  const { data: facts } = await db
    .from("work_memory_items")
    .select(MEMORY_ITEM_COLUMNS)
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("kind", "profile_fact")
    .eq("review_status", "confirmed")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(12);
  let profileFacts = (facts ?? []).map(row => ({ ...row,
    occurred_at: isoTimestamp(row.occurred_at)!, local_date: isoDate(row.local_date),
  })) as MemoryItem[];

  // Durable facts have no age cutoff. Search the complete confirmed set before
  // filling the bounded context with recent facts; proposals/rejections never
  // enter this lane and episodic time/kind filters do not hide durable facts.
  const trimmed = query.replace(/\s+/g, " ").trim().slice(0, 2_000);
  if (trimmed) {
    const relevant = await getPool().query(
      // Questions contain unrelated verbs; require at least one meaningful
      // lexeme rather than every word. The tsquery is parsed/escaped by Postgres
      // before changing conjunctions, never assembled from user SQL fragments.
      `with terms as (select replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery as query)
       select ${MEMORY_ITEM_COLUMNS} from work_memory_items, terms
       where organization_id = $1 and person_id = $2
         and kind = 'profile_fact' and review_status = 'confirmed'
         and search @@ terms.query
       order by ts_rank_cd(search, terms.query) desc,
                occurred_at desc, id desc limit 12`,
      [scope.organizationId, scope.personId, trimmed],
    );
    const relevantFacts = relevant.rows.map(row => ({ ...row,
      occurred_at: isoTimestamp(row.occurred_at)!, local_date: isoDate(row.local_date),
    })) as MemoryItem[];
    profileFacts = [...new Map([...relevantFacts, ...profileFacts].map(fact => [fact.id, fact])).values()].slice(0, 12);
  }

  let sameDayCandidates: MemoryItem[] = [];
  if (analysisLocalDate && options.includeSameDayCandidates !== false) {
    const { data: candidates } = await db
      .from("work_memory_items")
      .select(MEMORY_ITEM_COLUMNS)
      .eq("organization_id", scope.organizationId)
      .eq("person_id", scope.personId)
      .eq("kind", "profile_fact")
      .eq("review_status", "candidate")
      .eq("local_date", analysisLocalDate)
      .order("occurred_at", { ascending: false })
      .limit(8);
    sameDayCandidates = (candidates ?? []).map(row => ({ ...row,
      occurred_at: isoTimestamp(row.occurred_at)!, local_date: isoDate(row.local_date),
    })) as MemoryItem[];
  }

  if (!trimmed) return { items: [], profileFacts, sameDayCandidates, vectorUsed: false };

  let vectorHits: MemoryItem[] = [];
  let vectorUsed = false;
  if (memoryEmbeddingConfigured()) {
    try {
      const { embeddings } = await embedMemoryTexts([trimmed], "search_query");
      const res = await getPool().query(
        `select ${MEMORY_ITEM_COLUMNS}
           from work_memory_items
          where organization_id = $2 and person_id = $3 and embedding is not null
            and kind <> 'profile_fact'
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
        and kind <> 'profile_fact'
        and ($4::text[] is null or kind = any($4))
        and ($5::timestamptz is null or occurred_at >= $5)
        and ($6::timestamptz is null or occurred_at <= $6)
      order by ts_rank_cd(search, plainto_tsquery('english', $1)) desc
      limit $7`,
    [trimmed, scope.organizationId, scope.personId, kinds, options.from ?? null, options.to ?? null, candidateLimit],
  );

  const items = fuseMemoryRanks({ vector: vectorHits, lexical: lexical.rows as MemoryItem[], limit });
  return { items, profileFacts, sameDayCandidates, vectorUsed };
}

export async function buildMemoryPromptBlock(scope: MemoryScope & { localDate?: string }, query: string, options: RecallOptions = {}): Promise<string> {
  const { items, profileFacts, sameDayCandidates } = await recallWorkMemory(scope, query, options);
  return formatMemoryContext({ items, profileFacts, sameDayCandidates });
}

export function memoryEnabled(featureFlags: Record<string, boolean> = {}): boolean {
  return featureFlags.work_memory === true || process.env.WORK_OS_MEMORY_ENABLED === "true";
}

export interface MemoryFactRow {
  id: string;
  content: string;
  summary: string | null;
  review_status: "candidate" | "confirmed" | "rejected";
  fact_key: string | null;
  local_date: string | null;
  occurred_at: string;
  created_at: string;
}

export interface MemoryRecentRow {
  id: string;
  kind: WorkMemoryKind;
  content: string;
  summary: string | null;
  local_date: string | null;
  occurred_at: string;
  source_table: string;
  created_at: string;
}

export type MemoryFactStatus = "confirmed" | "candidate";

export interface MemoryFactPage {
  facts: MemoryFactRow[];
  total: number;
  nextCursor: string | null;
}

const FACT_COLUMNS = "id,content,summary,review_status,fact_key,local_date,occurred_at,created_at";

/** Independent keyset pages: a flood of proposals cannot evict kept memories.
 * The cursor is validated before it reaches SQL, and scope/status precede it. */
export async function listWorkMemoryFacts(scope: MemoryScope, options: {
  status: MemoryFactStatus; limit?: number; cursor?: string | null;
}): Promise<MemoryFactPage> {
  if (!["confirmed", "candidate"].includes(options.status)) throw new WorkOsValidationError("Invalid memory status.");
  const limit = Number.isFinite(options.limit) ? Math.min(Math.max(Math.floor(options.limit!), 1), 50) : 50;
  let cursor: { at: string; id: string } | null = null;
  if (options.cursor) {
    const [at, id, extra] = options.cursor.split("|");
    if (extra !== undefined || !at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(at)
      || !Number.isFinite(Date.parse(at)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? "")) {
      throw new WorkOsValidationError("Invalid memory cursor.");
    }
    cursor = { at, id };
  }
  const pool = getPool();
  const [page, counted] = await Promise.all([
    pool.query(`select ${FACT_COLUMNS},
        to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
      from work_memory_items
      where organization_id=$1 and person_id=$2 and kind='profile_fact' and review_status=$3
        ${cursor ? "and (occurred_at,id)<($4::timestamptz,$5::uuid)" : ""}
      order by occurred_at desc,id desc limit $${cursor ? 6 : 4}`,
    cursor ? [scope.organizationId, scope.personId, options.status, cursor.at, cursor.id, limit + 1]
      : [scope.organizationId, scope.personId, options.status, limit + 1]),
    pool.query(`select count(*)::integer as total from work_memory_items
      where organization_id=$1 and person_id=$2 and kind='profile_fact' and review_status=$3`,
    [scope.organizationId, scope.personId, options.status]),
  ]);
  const facts = page.rows.slice(0, limit).map(row => ({
    id: row.id, content: row.content, summary: row.summary,
    review_status: row.review_status, fact_key: row.fact_key,
    local_date: isoDate(row.local_date), occurred_at: isoTimestamp(row.occurred_at)!,
    created_at: isoTimestamp(row.created_at)!,
  })) as MemoryFactRow[];
  const last = facts.at(-1);
  return {
    facts, total: Number(counted.rows[0]?.total ?? 0),
    nextCursor: page.rows.length > limit && last ? `${page.rows[limit - 1].cursor_at}|${last.id}` : null,
  };
}

/** Backward-compatible summary: each status owns its quota and authoritative
 * total. Old clients still read facts/recent; new clients can load either tail. */
export async function listWorkMemory(scope: MemoryScope, limit = 50) {
  const db = createAdminClient();
  const capped = Math.min(Math.max(limit, 1), 100);
  const [confirmed, candidate, recentResult] = await Promise.all([
    listWorkMemoryFacts(scope, { status: "confirmed", limit: capped }),
    listWorkMemoryFacts(scope, { status: "candidate", limit: capped }),
    db
      .from("work_memory_items")
      .select("id,kind,content,summary,local_date,occurred_at,source_table,created_at")
      .eq("organization_id", scope.organizationId)
      .eq("person_id", scope.personId)
      .neq("kind", "profile_fact")
      .neq("kind", "digest")
      .order("occurred_at", { ascending: false })
      .limit(capped),
  ]);
  if (recentResult.error) throw new Error(`load recent memory: ${recentResult.error.message}`);
  return {
    facts: [...confirmed.facts, ...candidate.facts],
    recent: (recentResult.data ?? []) as MemoryRecentRow[],
    factTotals: { confirmed: confirmed.total, candidate: candidate.total },
    factNextCursors: { confirmed: confirmed.nextCursor, candidate: candidate.nextCursor },
  };
}

export async function reviewWorkMemoryFact(scope: MemoryScope, id: string, status: "confirmed" | "rejected"): Promise<{ id: string; review_status: string } | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("work_memory_items")
    .update({ review_status: status })
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("id", id)
    .eq("kind", "profile_fact")
    .select("id,review_status")
    .maybeSingle();
  if (error) throw new Error(`review memory fact: ${error.message}`);
  return data ? { id: String(data.id), review_status: String(data.review_status) } : null;
}

export async function deleteWorkMemoryItem(scope: MemoryScope, id: string): Promise<boolean> {
  const db = createAdminClient();
  const { data: item, error } = await db
    .from("work_memory_items")
    .select("id,source_table,source_id")
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load memory item: ${error.message}`);
  if (!item) return false;
  const { error: deleteError } = await db
    .from("work_memory_items")
    .delete()
    .eq("organization_id", scope.organizationId)
    .eq("person_id", scope.personId)
    .eq("id", id);
  if (deleteError) throw new Error(`delete memory item: ${deleteError.message}`);
  await db
    .from("work_memory_jobs")
    .delete()
    .eq("organization_id", scope.organizationId)
    .eq("source_table", String(item.source_table))
    .eq("source_id", String(item.source_id));
  return true;
}
