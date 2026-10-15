/** Presentation-only deduplication, retained across short activity leases.
 * A new WebView instance has its own source, so its counter can safely restart.
 * Callers create a fresh cursor when the account/workday scope changes. */
export function createMascotReceiptCursor() {
  const seen = new Map<string, number>();
  let revision = 0;
  return {
    observe(source: string, value: number) {
      if (!source || !Number.isSafeInteger(value) || value <= (seen.get(source) ?? 0)) return revision;
      seen.set(source, value);
      if (seen.size > 32) seen.delete(seen.keys().next().value!);
      return ++revision;
    },
  };
}
