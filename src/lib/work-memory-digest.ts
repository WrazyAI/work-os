import { createAdminClient } from "@/lib/supabase/admin";
import { recordWorkMemory, type MemoryScope } from "@/lib/work-memory";

/** Builds one deterministic digest per person per day from that day's memory
 * items. Re-running is safe: identical content is hash-deduplicated. */
export async function buildDailyMemoryDigests(localDate: string, limit = 50): Promise<{ built: number }> {
  const db = createAdminClient();
  const { data: scopes, error } = await db
    .from("work_memory_items")
    .select("organization_id,person_id")
    .eq("local_date", localDate)
    .neq("kind", "digest")
    .limit(500);
  if (error) throw new Error(`load digest scopes: ${error.message}`);

  const distinct = new Map<string, MemoryScope>();
  for (const row of scopes ?? []) {
    const scope = { organizationId: String(row.organization_id), personId: String(row.person_id) };
    distinct.set(`${scope.organizationId}:${scope.personId}`, scope);
  }

  let built = 0;
  for (const scope of [...distinct.values()].slice(0, limit)) {
    const { data: items, error: itemError } = await db
      .from("work_memory_items")
      .select("kind,content,summary,occurred_at")
      .eq("organization_id", scope.organizationId)
      .eq("person_id", scope.personId)
      .eq("local_date", localDate)
      .neq("kind", "digest")
      .order("occurred_at", { ascending: true })
      .limit(50);
    if (itemError) throw new Error(`load digest items: ${itemError.message}`);
    const rows = (items ?? []) as Array<{ kind: string; content: string; summary?: string | null }>;
    if (!rows.length) continue;
    const lines = rows
      .slice(0, 30)
      .map((item) => `- ${item.kind}: ${(item.summary || item.content).replace(/\s+/g, " ").trim().slice(0, 180)}`);
    const recorded = await recordWorkMemory(scope, {
      kind: "digest",
      sourceTable: "digest",
      sourceId: `daily:${localDate}`,
      content: `Daily memory digest for ${localDate}:\n${lines.join("\n")}`,
      summary: `${rows.length} memories recorded on ${localDate}`,
      metadata: { itemCount: rows.length, digestDate: localDate },
      localDate,
    });
    if (recorded) built += 1;
  }
  return { built };
}
