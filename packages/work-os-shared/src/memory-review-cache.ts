/** Apply only an authoritative Keep/Discard receipt, never an optimistic click.
 * Both clients retain this receipt if their subsequent read fails. */
type ReviewStatus = "confirmed" | "candidate" | "rejected";
type Fact = { id: string; review_status: ReviewStatus };
type Totals = { confirmed: number; candidate: number };

function adjustedTotal(total: number, lane: keyof Totals, before: ReviewStatus, after: ReviewStatus) {
  return Math.max(0, total + Number(after === lane) - Number(before === lane));
}

export function reviewedMemorySummary<T extends Fact, S extends { facts: T[]; factTotals?: Totals }>(
  summary: S | undefined, fact: T, status: "confirmed" | "rejected",
): S | undefined {
  if (!summary) return summary;
  // The fact may come from an older page the summary window never loaded. A
  // confirmed decision must remain usable even when every retry fails.
  const present = summary.facts.find(row => row.id === fact.id);
  return { ...summary,
    facts: status === "rejected"
      ? summary.facts.filter(row => row.id !== fact.id)
      : [...summary.facts.filter(row => row.id !== fact.id), { ...(present ?? fact), review_status: status }],
    factTotals: summary.factTotals ? {
      // A fact outside the summary window contributes only to the lane it
      // enters. Decisions never create a proposal.
      confirmed: Math.max(0, summary.factTotals.confirmed
        + Number(status === "confirmed") - Number(present?.review_status === "confirmed")),
      candidate: Math.max(0, summary.factTotals.candidate
        - Number(present?.review_status === "candidate")),
    } : undefined,
  };
}

export function reviewedMemoryPages<T extends Fact, D extends {
  pages: Array<{ facts: T[]; total: number }>; pageParams: unknown[];
}>(data: D | undefined, lane: keyof Totals, fact: T, status: "confirmed" | "rejected"): D | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page, index) => ({ ...page,
    facts: [
      ...(index === 0 && lane === status ? [{ ...fact, review_status: status }] : []),
      ...page.facts.filter(row => row.id !== fact.id),
    ],
    total: adjustedTotal(page.total, lane, fact.review_status, status),
  })) };
}
