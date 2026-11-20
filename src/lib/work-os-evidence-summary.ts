import { evidenceKind, type EvidenceKind } from "@/modules/work-os/evidence-kinds";

/** The bounded projection the evidence summary reads. Linked rows come from
 * `work_evidence`; uncredited GHL context rows are normalized to the same
 * fields before they reach this function. */
export type EvidenceSummaryInput = {
  source: string;
  evidence_date: string;
  title: string;
  person_id: string | null;
};

export type EvidenceSummaryPayload = {
  sources: Array<{ source: string; count: number }>;
  days: Array<{ date: string; count: number }>;
  kinds: Array<{ kind: EvidenceKind; count: number }>;
  peopleCount: number;
  /** True when the summary row read hit its bound; counts are disclosed as
   * capped rather than presented as exact. */
  capped?: boolean;
  coverage?: {
    people: Array<{
      personId: string | null;
      days: Array<{ date: string; count: number; emails: number }>;
    }>;
  };
};

/** Summarize linked evidence and uncredited provider context together, so a
 * source count, pulse, kind chip, and coverage cell can never disagree. */
export function summarizeEvidence(rows: EvidenceSummaryInput[], coverageRequested = false): EvidenceSummaryPayload {
  const sources = new Map<string, number>();
  const days = new Map<string, number>();
  const kinds = new Map<EvidenceKind, number>();
  const people = new Set<string>();
  const coverage = new Map<string, Map<string, { count: number; emails: number }>>();

  for (const row of rows) {
    const source = String(row.source || "unknown");
    const title = String(row.title || "Evidence");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(row.evidence_date) ? row.evidence_date : "";
    const kind = evidenceKind(source, title);
    sources.set(source, (sources.get(source) ?? 0) + 1);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (row.person_id) people.add(row.person_id);
    if (!day) continue;
    days.set(day, (days.get(day) ?? 0) + 1);
    if (!coverageRequested) continue;
    const personKey = row.person_id ?? "__none__";
    const dayCounts = coverage.get(personKey) ?? new Map<string, { count: number; emails: number }>();
    const current = dayCounts.get(day) ?? { count: 0, emails: 0 };
    current.count += 1;
    if (kind === "email") current.emails += 1;
    dayCounts.set(day, current);
    coverage.set(personKey, dayCounts);
  }

  const summary: EvidenceSummaryPayload = {
    sources: [...sources.entries()].map(([source, count]) => ({ source, count })).sort((left, right) => right.count - left.count),
    days: [...days.entries()].map(([date, count]) => ({ date, count })).sort((left, right) => left.date.localeCompare(right.date)),
    kinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((left, right) => right.count - left.count),
    peopleCount: people.size,
  };
  if (coverageRequested) {
    summary.coverage = {
      people: [...coverage.entries()].map(([personKey, dayCounts]) => ({
        personId: personKey === "__none__" ? null : personKey,
        days: [...dayCounts.entries()].map(([date, counts]) => ({ date, count: counts.count, emails: counts.emails })).sort((left, right) => left.date.localeCompare(right.date)),
      })),
    };
  }
  return summary;
}
