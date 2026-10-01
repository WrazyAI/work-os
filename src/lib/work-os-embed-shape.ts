/** The database shim resolves has-many embeds as arrays, so a to-one relation
 * such as an evidence event's retained screenshot can arrive as a one-element
 * array. Normalize both shapes at the edge so the UI always sees the row or
 * null — an empty array must never read as "retained". */
export function embeddedRow<T extends Record<string, unknown>>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  if (value && typeof value === "object") return value as T;
  return null;
}
