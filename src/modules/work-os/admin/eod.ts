/* Structured rendering for the generated EOD report markdown. The draft shape
 * is produced by src/lib/work-os-eod.ts: a title, meta lines, `##` sections
 * with bullet facts, and a closing activity-context disclaimer. Parsing is
 * deterministic and falls back to the raw text when the shape is unknown. */

export interface EodMetaLine {
  label: string;
  value: string;
}

export interface EodSectionLine {
  text: string;
  kind: "bullet" | "note";
}

export interface EodSection {
  heading: string;
  lines: EodSectionLine[];
}

export interface EodDocument {
  title: string | null;
  meta: EodMetaLine[];
  sections: EodSection[];
  closing: string | null;
}

const META_PATTERN = /^(Role profile|Goal|Goal source|Session quality):\s*(.*)$/;
const CLOSING_PREFIX = "Activity context is descriptive";

export function parseEodMarkdown(markdown: string): EodDocument {
  const document: EodDocument = { title: null, meta: [], sections: [], closing: null };
  const lines = String(markdown ?? "").split(/\r?\n/);
  let current: EodSection | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      document.title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("## ")) {
      current = { heading: line.slice(3).trim(), lines: [] };
      document.sections.push(current);
      continue;
    }
    if (line.startsWith(CLOSING_PREFIX)) {
      document.closing = line;
      continue;
    }
    const metaMatch = META_PATTERN.exec(line);
    if (metaMatch && !current) {
      document.meta.push({ label: metaMatch[1], value: metaMatch[2] || "—" });
      continue;
    }
    if (!current) continue;
    const text = line.startsWith("- ") ? line.slice(2).trim() : line;
    const emptyNote = /^(No |Nothing |None\.?$)/.test(text);
    current.lines.push({ text, kind: emptyNote ? "note" : "bullet" });
  }
  return document;
}

/** One-line snippet for queue rows: the first completed fact, else the first
 * fact anywhere in the report. */
export function eodSnippet(markdown: string, limit = 110): string | null {
  const document = parseEodMarkdown(markdown);
  const preferred = document.sections.find((section) => /completed work/i.test(section.heading));
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
    ["completed", "Completed"],
    ["progressed", "Progressed"],
    ["deferred", "Deferred"],
    ["carried", "Carried"],
    ["unplanned", "Unplanned"],
  ];
  return keys
    .map(([key, label]) => ({ label, value: Number(source[key] ?? 0) || 0 }))
    .filter((fact) => fact.value > 0);
}
