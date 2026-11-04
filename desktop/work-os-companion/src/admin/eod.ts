/* Structured rendering for the deterministic EOD report. The companion admin
 * reads the same shared document as the web admin, including the full-record
 * appendix, so the two review surfaces cannot drift. */

import { parseEodMarkdown, type EodDocument } from "../../../../src/modules/work-os/eod-document";

export type { EodDocument, EodMetaLine, EodSection, EodSectionLine } from "../../../../src/modules/work-os/eod-document";
export { parseEodMarkdown };

/** One-line snippet for queue rows: the first completed fact, else the first
 * fact anywhere in the report. */
export function eodSnippet(markdown: string, limit = 110): string | null {
  const document: EodDocument = parseEodMarkdown(markdown);
  const preferred = document.sections.find((section) => section.key === "completed");
  const fact = preferred?.lines.find((line) => line.kind === "bullet")
    ?? document.sections.flatMap((section) => section.lines).find((line) => line.kind === "bullet");
  if (!fact) return null;
  const text = fact.text.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Metrics recorded with the draft, rendered as a compact fact strip. */
export function eodMetricFacts(metrics: Record<string, unknown> | null | undefined): Array<{ label: string; value: number }> {
  const source = metrics ?? {};
  const keys: Array<[string, string]> = [
    ["deliverables", "Deliverables"],
    ["completed", "Completed"],
    ["progressed", "Recaps"],
    ["deferred", "Carried / deferred"],
    ["unplanned", "Evidence"],
  ];
  return keys
    .map(([key, label]) => ({ label, value: Number(source[key] ?? 0) || 0 }))
    .filter((fact) => fact.value > 0);
}
