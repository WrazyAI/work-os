/** Pure activity-interval projections shared by the employee engine and the
 * reviewed-recap ledger. Keeping them in a neutral module means the ledger does
 * not import the AI/screenshot engine just to render the same canonical words;
 * the engine re-exports these helpers so existing callers stay unchanged. */

/** The synthesis revision a row carries, normalised for clients: a positive
 * integer, 1 when the column is absent (every row written before revisions
 * existed) or unusable. This is the generation revision, never the immutable
 * reviewed-recap version. */
export function intervalRevision(row: { revision?: unknown }): number {
  const value = Math.floor(Number(row?.revision));
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

/** The Postgres shim returns timestamptz columns as Date objects, but every
 * API payload must carry ISO instants so clients on any runtime parse them
 * identically. Invalid values stay as their original text rather than throwing. */
export function isoInstant(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  const text = String(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

/** Compact structured recap fields, parsed defensively from the stored
 * synthesis so an older or malformed row can never break a card. The card
 * renders these as scannable bullets instead of one dense paragraph. */
export function intervalStructure(row: { structured_summary?: unknown }): {
  activities: string[];
  workflow: string[];
  uncertainties: string[];
  recordedActivity: Array<{ description: string; relation: "performed" | "triggered"; url: string | null }>;
} {
  const source = row.structured_summary && typeof row.structured_summary === "object" && !Array.isArray(row.structured_summary)
    ? row.structured_summary as Record<string, unknown>
    : {};
  const objectPhrases = (value: unknown, key: string, limit: number, maxChars: number) => Array.isArray(value)
    ? value.flatMap((entry) => {
        const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>)[key] : null;
        const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
        return text ? [text.slice(0, maxChars)] : [];
      }).slice(0, limit)
    : [];
  const stringPhrases = (value: unknown, limit: number, maxChars: number) => Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = typeof entry === "string" ? entry.replace(/\s+/g, " ").trim() : "";
        return text ? [text.slice(0, maxChars)] : [];
      }).slice(0, limit)
    : [];
  const recordedActivity = Array.isArray(source.recordedActivity) ? source.recordedActivity : Array.isArray(source.recorded_activity) ? source.recorded_activity : [];
  return {
    activities: objectPhrases(source.activities, "description", 8, 200),
    workflow: objectPhrases(source.workflow, "phase", 6, 80),
    uncertainties: stringPhrases(source.uncertainties, 3, 140),
    recordedActivity: recordedActivity.flatMap((entry) => {
      const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
      const description = typeof item?.description === "string" ? item.description.replace(/\s+/g, " ").trim().slice(0, 200) : "";
      const relation = item?.relation === "triggered" ? "triggered" as const : item?.relation === "performed" ? "performed" as const : null;
      const url = typeof item?.url === "string" && item.url.trim() ? item.url.trim().slice(0, 400) : null;
      return description && relation ? [{ description, relation, url }] : [];
    }).slice(0, 8),
  };
}

/** The immutable review version an employee card must echo. An inferred recap
 * is 0; a reviewed row whose deterministic lazy snapshot has not been written
 * yet is 1 — the version that snapshot will receive — so a deliberate later
 * correction can still start at version 2. `review_version` must come from the
 * same statement snapshot as the row it describes; the generation `revision`
 * is never used. */
export function reviewVersionForRow(row: { review_status?: unknown; review_version?: unknown }): number {
  const status = String(row.review_status ?? "");
  if (status !== "confirmed" && status !== "amended") return 0;
  const latest = Math.floor(Number(row.review_version));
  return Number.isFinite(latest) && latest >= 1 ? latest : 1;
}

/** The recap's own words, for a spoken read: the lead line the card shows
 * (final detail when the employee amended it, otherwise the model's) and the
 * structured activity lines. The card, the prompter and the voice all render
 * from this one source. */
export function intervalSpeechSource(row: { final_detail?: unknown; ai_detail?: unknown; headline?: unknown; structured_summary?: unknown }): {
  detail: string | null;
  headline: string | null;
  activities: string[];
} {
  const detail = row.final_detail ? String(row.final_detail) : row.ai_detail ? String(row.ai_detail) : null;
  return {
    detail,
    headline: row.headline ? String(row.headline) : null,
    activities: intervalStructure(row).activities,
  };
}
