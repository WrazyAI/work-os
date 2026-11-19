/** A GHL row with no person attribution is still not anonymous when the
 * provider actor or relation is known. Name that context instead of calling
 * the row unattributed; only rows without a provider label stay unlabelled. */
export function evidencePersonLabel(row: {
  person?: { display_name?: string | null } | null;
  source?: string | null;
  ghl?: { actorLabel?: string | null } | null;
}): string {
  if (row.person?.display_name) return row.person.display_name;
  if (row.source === "ghl") return row.ghl?.actorLabel ?? "Shared GHL activity";
  return "Unattributed";
}
