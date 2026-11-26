import type { AdminOverview } from "@/lib/work-os-admin-overview";

/** The web Overview's read model. The API supplies fourteen chronological
 * workdays; this module keeps the pulse, trend, age, and day-close arithmetic
 * identical to the companion surface without importing either UI. */

export type OverviewMetric = "completed" | "updates" | "recaps" | "evidence";

export interface OverviewDay {
  date: string;
  completed: number;
  updates: number;
  recaps: number;
  evidence: number;
  minutes: number;
}

export interface OverviewTotals {
  completed: number;
  updates: number;
  recaps: number;
  evidence: number;
  minutes: number;
}

export interface OverviewReviewAge {
  value: number;
  unit: "hour" | "day";
  phrase: string;
}

export interface OverviewModel {
  data: AdminOverview;
  days: OverviewDay[];
  recent: OverviewDay[];
  prior: OverviewDay[];
  recentTotals: OverviewTotals;
  priorTotals: OverviewTotals;
  people: AdminOverview["people"];
  reviewWaiting: number;
  oldestReview: OverviewReviewAge | null;
  eodSubmittedPeople: number;
  generatedAt: number;
  headline: string;
  deck: string;
}

export const OVERVIEW_METRICS: Array<{ id: OverviewMetric; label: string; noun: string; href: string; action: string }> = [
  { id: "completed", label: "Outcomes", noun: "completed outcomes", href: "/work-os/admin/tasks", action: "Open Tasks" },
  { id: "updates", label: "Updates", noun: "recorded updates", href: "/work-os/admin/people", action: "Open People" },
  { id: "recaps", label: "Recaps", noun: "generated recaps", href: "/work-os/admin/insights", action: "Open Insights" },
  { id: "evidence", label: "Evidence", noun: "evidence rows", href: "/work-os/admin/evidence", action: "Open Evidence" },
];

export function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function isAre(value: number) {
  return value === 1 ? "is" : "are";
}

export function deltaPercent(current: number, previous: number) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function deltaText(current: number, previous: number) {
  const delta = deltaPercent(current, previous);
  if (delta === null) return "no prior record";
  if (delta === 0) return "level with prior 7";
  return `${Math.abs(delta)}% ${delta > 0 ? "above" : "below"} prior 7`;
}

export function comparisonPhrase(current: number, previous: number) {
  const delta = deltaPercent(current, previous);
  if (delta === null) return "with no prior record to compare";
  if (delta === 0) return "level with the seven before";
  return `${Math.abs(delta)}% ${delta > 0 ? "above" : "below"} the seven before`;
}

export function totalsFor(days: OverviewDay[]): OverviewTotals {
  return days.reduce((total, day) => ({
    completed: total.completed + day.completed,
    updates: total.updates + day.updates,
    recaps: total.recaps + day.recaps,
    evidence: total.evidence + day.evidence,
    minutes: total.minutes + day.minutes,
  }), { completed: 0, updates: 0, recaps: 0, evidence: 0, minutes: 0 });
}

export function buildOverviewModel(data: AdminOverview): OverviewModel {
  const minutesByDate = new Map(data.timeSeries.map((point) => [point.date, point]));
  const days: OverviewDay[] = data.series.map((point) => ({
    date: point.date,
    completed: point.completed,
    updates: point.updates,
    recaps: point.recaps,
    evidence: point.evidence,
    minutes: minutesByDate.get(point.date)?.totalMinutes ?? 0,
  }));
  const recent = days.slice(-7);
  const prior = days.slice(Math.max(0, days.length - 14), Math.max(0, days.length - 7));
  const recentTotals = totalsFor(recent);
  const priorTotals = totalsFor(prior);
  const counts = data.counts;
  const reviewWaiting = Math.max(0, counts.recapsToday - counts.recapsReviewedToday - (counts.recapsAutoApprovedToday ?? 0));
  const generatedAt = Date.parse(data.generatedAt) || Date.now();
  const oldestAt = counts.pendingReviewOldestAt ? Date.parse(counts.pendingReviewOldestAt) : NaN;
  const oldestAgeMs = Number.isFinite(oldestAt) ? Math.max(0, generatedAt - oldestAt) : null;
  const oldestReview = oldestAgeMs === null
    ? null
    : oldestAgeMs < 86_400_000
      ? { value: Math.max(1, Math.floor(oldestAgeMs / 3_600_000)), unit: "hour" as const, phrase: "" }
      : { value: Math.floor(oldestAgeMs / 86_400_000), unit: "day" as const, phrase: "" };
  if (oldestReview) oldestReview.phrase = plural(oldestReview.value, oldestReview.unit);
  const eodSubmittedPeople = data.people.filter((person) =>
    person.eodToday === "submitted" || person.eodToday === "pending_review" || person.eodToday === "approved").length;
  const people = [...data.people].sort((left, right) => {
    const rank = (person: AdminOverview["people"][number]) =>
      person.attendance.state === "active" ? 0
        : person.attendance.state === "paused" ? 1
          : person.attendance.state === "off_shift" ? 2 : 3;
    return rank(left) - rank(right) || left.displayName.localeCompare(right.displayName);
  });

  let headline = "The day's record is clear.";
  if (counts.disputedEvidence > 0) {
    headline = `${plural(counts.disputedEvidence, "evidence record")} ${isAre(counts.disputedEvidence)} waiting on a ruling.`;
  } else if (counts.tasksOverdue > counts.reportsPendingReview && counts.tasksOverdue > 0) {
    headline = `${plural(counts.tasksOverdue, "outcome")} ${isAre(counts.tasksOverdue)} past due.`;
  } else if (counts.reportsPendingReview > 0) {
    headline = `${plural(counts.reportsPendingReview, "report")} ${isAre(counts.reportsPendingReview)} waiting on review.`;
  } else if (counts.eodOutstandingDays > 0) {
    headline = `${plural(counts.eodOutstandingDays, "workday")} still ${counts.eodOutstandingDays === 1 ? "lacks" : "lack"} an EOD report.`;
  }

  const deckParts = [
    `${counts.onShift} of ${counts.people} ${counts.people === 1 ? "teammate" : "teammates"} ${isAre(counts.onShift)} on shift.`,
    `${plural(counts.tasksCompletedToday, "outcome")} landed today, with ${plural(counts.evidenceToday, "evidence item")} recorded.`,
  ];
  if (oldestReview) {
    deckParts.push(`The oldest report has waited ${oldestReview.phrase}.`);
  } else if (reviewWaiting > 0) {
    deckParts.push(`${plural(reviewWaiting, "recap")} ${isAre(reviewWaiting)} still waiting for review.`);
  }

  return {
    data, days, recent, prior, recentTotals, priorTotals,
    people, reviewWaiting, oldestReview, eodSubmittedPeople, generatedAt,
    headline, deck: deckParts.join(" "),
  };
}
