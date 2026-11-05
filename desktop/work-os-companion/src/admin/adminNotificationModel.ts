import { relativeTime, statusLabel } from "./data";
import type { AdminOverview, AdminSection, AdminSectionFocus } from "./types";

/** A decision the administrator can resolve from the notifications panel. The
 * overview endpoint already computes the authoritative counts and copy; this
 * model only gives each row a stable destination and a human action name. */
export type AdminNotificationDecision = {
  id: string;
  code: string;
  severity: "info" | "warn" | "error";
  title: string;
  meta: string;
  count: number;
  action: string;
  section: AdminSection;
  focus?: AdminSectionFocus;
};

export type AdminNotificationActivity = {
  id: string;
  kind: AdminOverview["recentActivity"][number]["kind"];
  title: string;
  meta: string;
  time: string;
  section: AdminSection;
  focus?: AdminSectionFocus;
};

export type AdminNotificationPulse = {
  value: number;
  label: string;
};

/** Cards whose code is unknown still land somewhere real: the section named by
 * the server's href when it can be recognized, otherwise the overview. */
function sectionForAttentionHref(href: string | null): AdminSection {
  if (!href) return "overview";
  const tail = href.replace(/\/$/, "").split("/").pop() ?? "";
  const sections: AdminSection[] = ["people", "tasks", "review", "insights", "evidence", "settings"];
  return sections.find((section) => section === tail) ?? "overview";
}

/** The server's code names differ slightly from the earlier preview fixture;
 * both spellings resolve to the same decision. */
function canonicalCode(code: string): string {
  if (code === "reports_pending") return "reports_pending_review";
  if (code === "disputed_evidence") return "evidence_disputed";
  return code;
}

function decisionMeta(overview: AdminOverview, code: string, now: number): string {
  if (code === "reports_pending_review") {
    const oldest = overview.counts.pendingReviewOldestAt
      ? relativeTime(overview.counts.pendingReviewOldestAt, now)
      : "—";
    return oldest !== "—"
      ? `Oldest submitted ${oldest}.`
      : "Submitted reports wait here until you approve them or ask for changes.";
  }
  if (code === "eod_outstanding") {
    const days = overview.counts.eodOutstandingDays;
    return days > 0
      ? `${days} unsubmitted workday${days === 1 ? "" : "s"} from the last 14 days.`
      : "Workdays without a submitted report from the last 14 days.";
  }
  if (code === "tasks_overdue") return "Unfinished work past its due date.";
  if (code === "evidence_disputed") return "Evidence an employee disputed.";
  if (code === "readiness_blocked") return "These block the full employee workflow.";
  return "Needs an administrator decision.";
}

function decisionAction(code: string): string {
  return code === "readiness_blocked" ? "Fix" : "Review";
}

/** Every attention record the overview currently reports, ordered as the server
 * ranks it. A zero-count record is not a notification and stays out. */
export function adminNotificationDecisions(
  overview: AdminOverview,
  now = Number.isFinite(Date.parse(overview.generatedAt)) ? Date.parse(overview.generatedAt) : Date.now(),
): AdminNotificationDecision[] {
  return overview.attention
    .filter((item) => item.count > 0)
    .map((item, index) => {
      const code = canonicalCode(item.code);
      const fallbackSection = sectionForAttentionHref(item.href);
      const section: AdminSection = code === "reports_pending_review" || code === "eod_outstanding"
        ? "review"
        : code === "tasks_overdue"
          ? "tasks"
          : code === "evidence_disputed"
            ? "evidence"
            : code === "readiness_blocked"
              ? "settings"
              : fallbackSection;
      return {
        id: `${item.code}:${index}`,
        code,
        severity: item.severity,
        title: item.message,
        meta: decisionMeta(overview, code, now),
        count: item.count,
        action: decisionAction(code),
        section,
        ...(code === "tasks_overdue" ? { focus: { taskView: "open" as const } } : {}),
      };
    });
}

/** A truthful empty notification record for the dev-only shell harness, which
 * pins the bell's state while still seeding the page's overview. It never
 * touches the page's cached record. */
export function emptyAdminNotificationOverview(overview: AdminOverview): AdminOverview {
  return {
    ...overview,
    counts: {
      ...overview.counts,
      onShift: 0,
      paused: 0,
      updatesToday: 0,
      substantiveUpdatesToday: 0,
      recapsToday: 0,
      recapsReviewedToday: 0,
      tasksCompletedToday: 0,
      tasksOpen: 0,
      tasksOverdue: 0,
      evidenceToday: 0,
      evidenceActivityToday: 0,
      evidenceOutputToday: 0,
      reportsDraftedToday: 0,
      reportsSubmittedToday: 0,
      reportsPendingReview: 0,
      pendingReviewOldestAt: null,
      eodOutstandingPeople: 0,
      eodOutstandingDays: 0,
      disputedEvidence: 0,
    },
    recentActivity: [],
    attention: [],
  };
}

/** The badge and the Admin tab count: every underlying record the decision rows
 * name, not the number of categories. */
export function adminNotificationDecisionCount(overview: AdminOverview | null | undefined): number {
  return Math.max(0, (overview?.attention ?? []).reduce((total, item) => total + Math.max(0, item.count), 0));
}

/** The header's one-line description of what is waiting, in the same voice as
 * the employee panel. */
export function adminNotificationSummary(overview: AdminOverview | null | undefined): string {
  if (!overview) return "Checking the workspace record…";
  const counts = overview.counts;
  const parts: string[] = [];
  if (counts.reportsPendingReview > 0) {
    parts.push(`${counts.reportsPendingReview} EOD report${counts.reportsPendingReview === 1 ? "" : "s"} to review`);
  }
  if (counts.eodOutstandingPeople > 0) {
    parts.push(`${counts.eodOutstandingPeople} teammate${counts.eodOutstandingPeople === 1 ? "" : "s"} with outstanding EODs`);
  }
  if (counts.tasksOverdue > 0) {
    parts.push(`${counts.tasksOverdue} overdue task${counts.tasksOverdue === 1 ? "" : "s"}`);
  }
  if (counts.disputedEvidence > 0) {
    parts.push(`${counts.disputedEvidence} disputed evidence item${counts.disputedEvidence === 1 ? "" : "s"}`);
  }
  const blockers = overview.attention.find((item) => canonicalCode(item.code) === "readiness_blocked")?.count ?? 0;
  if (blockers > 0) parts.push(`${blockers} configuration blocker${blockers === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "You're caught up";
}

/** The quiet pulse line: four live measures, never a row of KPI cards. */
export function adminNotificationPulse(overview: AdminOverview | null | undefined): AdminNotificationPulse[] {
  if (!overview) return [];
  return [
    { value: overview.counts.onShift, label: "on shift" },
    { value: overview.counts.recapsToday, label: "recaps" },
    { value: overview.counts.tasksCompletedToday, label: "outcomes" },
    { value: overview.counts.evidenceToday, label: "evidence" },
  ];
}

function activityTarget(item: AdminOverview["recentActivity"][number]): { section: AdminSection; focus?: AdminSectionFocus } {
  const personId = item.personId ?? undefined;
  if (item.kind === "task_completed") {
    return { section: "tasks", focus: { ...(personId ? { personId } : {}), taskView: "completed" } };
  }
  if (item.kind === "eod_submitted") {
    return { section: "review", focus: personId ? { personId } : undefined };
  }
  if (item.kind === "evidence") {
    return { section: "evidence", focus: personId ? { personId } : undefined };
  }
  if (item.kind === "recap" || item.kind === "update") {
    return { section: "people", focus: personId ? { personId } : undefined };
  }
  return { section: "overview" };
}

function activityMeta(item: AdminOverview["recentActivity"][number]): string {
  return [item.personName, item.detail, item.provenance ? statusLabel(item.provenance) : null]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" · ");
}

/** Recent activity in the overview's own newest-first order. The section is
 * capped here so a busy workspace keeps the panel scannable; the Overview page
 * still owns the full record. */
export function adminNotificationActivity(overview: AdminOverview | null | undefined, limit = 6): AdminNotificationActivity[] {
  if (!overview) return [];
  // The overview's own generation instant is the honest reference: it keeps
  // this panel and the Overview page saying the same relative time even when a
  // retained snapshot is all the app could load.
  const generatedAt = Date.parse(overview.generatedAt);
  const now = Number.isFinite(generatedAt) ? generatedAt : Date.now();
  return overview.recentActivity.slice(0, Math.max(0, limit)).map((item) => {
    const target = activityTarget(item);
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      meta: activityMeta(item),
      time: relativeTime(item.at, now),
      section: target.section,
      ...(target.focus ? { focus: target.focus } : {}),
    };
  });
}
