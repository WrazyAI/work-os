import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  Database,
  FileCheck2,
  ListChecks,
  MessageSquareText,
  RefreshCw,
  Users,
} from "lucide-react";
import { KpiCard } from "../InsightCharts";
import { useNotifications } from "../NotificationFlyouts";
import { ActivityDetailDrawer, activityRecordFromOverview, type ActivityDetailRecord } from "./ActivityDetail";
import { ADMIN_OVERVIEW_STALE_KEY, overviewStaleMessage } from "./adminNotifications";
import { StackedTimeBars } from "./charts";
import { adminKeys, adminReadinessQueryOptions, attendanceLabel, attendanceTone, fetchAdminOverview, formatDuration, normalizeAdminOverview, relativeTime, statusLabel, todayIso } from "./data";
import { readinessAttention } from "../../../../src/modules/work-os/admin-readiness";
import { AdminButton, AdminCard, Avatar, Empty, Notice, Pill, Skeleton } from "./ui";
import type { AdminOverview, AdminSection, AdminSectionFocus } from "./types";

/** Maps an overview attention href (a web console path) onto the desktop
 * section it belongs to, so a row always lands somewhere real. */
export function sectionForHref(href: string | null): AdminSection {
  if (!href) return "overview";
  const tail = href.replace(/\/$/, "").split("/").pop() ?? "";
  if (tail === "people") return "people";
  if (tail === "tasks") return "tasks";
  if (tail === "review") return "review";
  if (tail === "insights") return "insights";
  if (tail === "evidence") return "evidence";
  if (tail === "settings") return "settings";
  return "overview";
}

function activityTone(kind: string): "ok" | "observed" | "neutral" | "warn" {
  if (kind === "task_completed") return "ok";
  if (kind === "eod_submitted") return "info" as unknown as "ok";
  if (kind === "evidence") return "observed";
  return "neutral";
}

export default function OverviewPage({ onOpenSection, onOpenPerson, onOpenRecaps }: {
  onOpenSection: (section: AdminSection, focus?: AdminSectionFocus) => void;
  onOpenPerson: (personId: string) => void;
  onOpenRecaps: () => void;
}) {
  const [activity, setActivity] = useState<ActivityDetailRecord | null>(null);
  const rightNowRef = useRef<HTMLDivElement | null>(null);
  const rightNowTableRef = useRef<HTMLDivElement | null>(null);
  const notifications = useNotifications();
  const readiness = useQuery(adminReadinessQueryOptions());
  const overview = useQuery<AdminOverview>({
    queryKey: adminKeys.overview(todayIso()),
    queryFn: () => fetchAdminOverview(),
    // The cache can hold a record a previous build persisted; the page reads
    // the normalized shape either way.
    select: normalizeAdminOverview,
    staleTime: 30_000,
    // The dashboard's one deliberate poll: every 60 seconds while the window
    // is focused, so a hidden window never revalidates the snapshot unseen.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // A snapshot that stopped refreshing is a standing condition the page cannot
  // otherwise show: one persistent card under a stable key, cleared when a
  // fresh snapshot lands.
  const generatedAt = overview.data?.generatedAt ?? null;
  useEffect(() => {
    const message = overviewStaleMessage(generatedAt);
    if (!message) {
      notifications.clearPersistent(ADMIN_OVERVIEW_STALE_KEY);
      return;
    }
    notifications.persistent(ADMIN_OVERVIEW_STALE_KEY, message, "Overview snapshot is stale", "info");
  }, [generatedAt, notifications]);

  if (overview.isLoading) {
    return (
      <div className="admin-grid">
        <div className="admin-kpi-strip">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[104px]" />)}
        </div>
        <div className="admin-band">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (overview.error || !overview.data) {
    return (
      <Notice tone="err">
        The workspace overview could not be loaded.
        <AdminButton variant="ghost" icon={RefreshCw} onClick={() => void overview.refetch()}>Retry</AdminButton>
      </Notice>
    );
  }

  const data = overview.data;
  const attention = [...data.attention.filter((item) => item.code !== "readiness_blocked"), ...readinessAttention(readiness.data)];
  const counts = data.counts;
  const people = [...data.people]
    .sort((left, right) => {
      const rank = (person: AdminOverview["people"][number]) => person.attendance.state === "active" ? 0 : person.attendance.state === "paused" ? 1 : person.attendance.state === "off_shift" ? 2 : 3;
      return rank(left) - rank(right) || left.displayName.localeCompare(right.displayName);
    });
  const hasTime = data.timeSeries.some((point) => point.totalMinutes > 0);
  const pendingOldest = counts.pendingReviewOldestAt ? relativeTime(counts.pendingReviewOldestAt, Date.parse(data.generatedAt)) : null;
  const recapsWaiting = Math.max(0, counts.recapsToday - counts.recapsReviewedToday);
  const recapDetail = counts.recapsToday === 0
    ? "no recaps yet"
    : recapsWaiting === 0
      ? `${counts.recapsReviewedToday} reviewed`
      : `${counts.recapsReviewedToday} reviewed · ${recapsWaiting} waiting`;
  const onShiftDetail = counts.paused > 0
    ? `${counts.paused} paused · ${counts.people} teammate${counts.people === 1 ? "" : "s"}`
    : `of ${counts.people} teammate${counts.people === 1 ? "" : "s"}`;
  const outcomesDetail = `${counts.tasksOpen} open · ${counts.tasksOverdue} overdue`;
  const reviewDetail = counts.reportsPendingReview > 0 && pendingOldest ? `oldest ${pendingOldest}` : "queue is clear";
  const evidenceDetail = `${counts.evidenceOutputToday} output · ${counts.evidenceActivityToday} activity`;
  const showRightNow = () => {
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rightNowRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    rightNowTableRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="admin-grid">
      <div className="admin-kpi-strip" role="group" aria-label="Today at a glance">
        <KpiCard
          label="On shift now"
          value={String(counts.onShift)}
          detail={onShiftDetail}
          onSelect={showRightNow}
          actionLabel={`On shift now: ${counts.onShift}, ${onShiftDetail}. Show the Right now table`}
        />
        <KpiCard
          label="Recaps today"
          value={String(counts.recapsToday)}
          detail={recapDetail}
          spark={data.series.map((point) => point.recaps)}
          sparkLabel="Recaps per day over the last 14 days"
          onSelect={onOpenRecaps}
          actionLabel={`Recaps today: ${counts.recapsToday}, ${recapDetail}. Open Admin Otto recaps`}
        />
        <KpiCard
          label="Outcomes today"
          value={String(counts.tasksCompletedToday)}
          detail={outcomesDetail}
          spark={data.series.map((point) => point.completed)}
          sparkLabel="Completed outcomes per day over the last 14 days"
          onSelect={() => onOpenSection("tasks")}
          actionLabel={`Outcomes today: ${counts.tasksCompletedToday}, ${outcomesDetail}. Open Tasks`}
        />
        <KpiCard
          label="Awaiting review"
          value={String(counts.reportsPendingReview)}
          detail={reviewDetail}
          onSelect={() => onOpenSection("review")}
          actionLabel={`Awaiting review: ${counts.reportsPendingReview}, ${reviewDetail}. Open EOD Review`}
        />
        <KpiCard
          label="Evidence today"
          value={String(counts.evidenceToday)}
          detail={evidenceDetail}
          spark={data.series.map((point) => point.evidence)}
          sparkLabel="Evidence items per day over the last 14 days"
          onSelect={() => onOpenSection("evidence")}
          actionLabel={`Evidence today: ${counts.evidenceToday}, ${evidenceDetail}. Open Evidence`}
        />
      </div>

      <div className="admin-band">
        <AdminCard
          icon={Clock3}
          title="Time worked"
          detail="Observed work time per day, split by teammate over the last 14 days"
          action={<span className="admin-quiet">updated {relativeTime(data.generatedAt)}</span>}
        >
          {hasTime ? (
            <StackedTimeBars ariaLabel="Observed work time per day for the last 14 days, split by teammate" points={data.timeSeries} />
          ) : (
            <p className="admin-empty-note">No observed work time was recorded in the last 14 days.</p>
          )}
        </AdminCard>

        <AdminCard
          icon={AlertTriangle}
          title="Needs attention"
          detail={attention.length ? "What the record says needs a decision" : undefined}
          action={<AdminButton variant="ghost" icon={FileCheck2} onClick={() => onOpenSection("review")}>Open review</AdminButton>}
        >
          {readiness.isError ? <Notice tone="warn">Setup checks could not be refreshed. <AdminButton variant="ghost" onClick={() => void readiness.refetch()}>Retry setup checks</AdminButton></Notice> : readiness.isPending ? <p className="admin-quiet">Checking workspace setup…</p> : null}
          {attention.length ? (
            <ul className="admin-attention">
              {attention.map((item) => (
                <li key={item.code}>
                  <button type="button" onClick={() => onOpenSection(sectionForHref(item.href))}>
                    <span className={`admin-dot ${item.severity}`} aria-hidden />
                    <span className="min-w-0">{item.message}</span>
                    <b>{item.count}</b>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="admin-ready">
              <CheckCircle2 size={16} aria-hidden />
              <span>Nothing needs attention. Reviews, EODs, and the task record are clear.</span>
            </div>
          )}
        </AdminCard>
      </div>

      <div className="admin-band admin-band-roster" ref={rightNowRef}>
        <AdminCard
          icon={Users}
          title="Right now"
          detail={`${counts.people} teammate${counts.people === 1 ? "" : "s"} · ${counts.onShift} on shift · ${counts.offShift} off shift · ${counts.unknown} not observed`}
          action={<AdminButton variant="ghost" icon={Users} onClick={() => onOpenSection("people")}>Open People</AdminButton>}
          padded={false}
        >
          {people.length ? (
            <div
              className="admin-table-wrap admin-scroll-target"
              ref={rightNowTableRef}
              tabIndex={0}
              role="region"
              aria-label="Right now: teammates and their status"
            >
              <table className="admin-table">
                <thead>
                  <tr><th>Person</th><th>Status now</th><th>Today</th><th>EOD</th><th>Last recap</th></tr>
                </thead>
                <tbody>
                  {people.slice(0, 8).map((person) => (
                    <tr key={person.personId} onClick={() => onOpenPerson(person.personId)}>
                      <td data-label="Person">
                        <span className="admin-person">
                          <Avatar name={person.displayName} size={28} />
                          <span className="min-w-0">
                            <b><button type="button" className="admin-record-open" aria-label={`Open ${person.displayName} record`} onClick={(event) => { event.stopPropagation(); onOpenPerson(person.personId); }}>{person.displayName}</button></b>
                            <small>{person.roleProfile ?? "Unmapped role"}{person.schedule ? ` · ${person.schedule.start}–${person.schedule.end}` : " · No schedule"}</small>
                          </span>
                        </span>
                      </td>
                      <td data-label="Status now">
                        <Pill tone={attendanceTone(person.attendance.state)}>
                          {attendanceLabel(person.attendance.state)}{person.attendance.freshness === "stale" ? " · stale" : ""}
                        </Pill>
                      </td>
                      <td data-label="Today" className="admin-numeric">
                        {person.recapsToday} recap{person.recapsToday === 1 ? "" : "s"} · {person.tasksCompletedToday} done{person.evidenceToday ? ` · ${person.evidenceToday} evidence` : ""}
                      </td>
                      <td data-label="EOD">
                        {person.eodToday
                          ? <Pill tone={person.eodToday === "approved" ? "ok" : person.eodToday === "pending_review" ? "info" : "neutral"}>{statusLabel(person.eodToday)}</Pill>
                          : person.eodOutstanding ? <Pill tone="warn">Outstanding</Pill> : <span className="admin-quiet">—</span>}
                      </td>
                      <td data-label="Last recap" className="admin-quiet">{person.lastRecapAt ? relativeTime(person.lastRecapAt, Date.parse(data.generatedAt)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {people.length > 8 ? (
                <p className="admin-table-foot">Showing 8 of {people.length} teammates. <button type="button" onClick={() => onOpenSection("people")}>See all in People</button>.</p>
              ) : null}
            </div>
          ) : (
            <div className="admin-card-body is-padded">
              <Empty title="No people yet" body="People are created through onboarding or membership mapping in Settings." />
            </div>
          )}
        </AdminCard>

        <AdminCard icon={Activity} title="Recent activity" detail="Updates, completions, evidence, and submissions as recorded">
          {data.recentActivity.length ? (
            <ul className="admin-activity">
              {data.recentActivity.slice(0, 10).map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => setActivity(activityRecordFromOverview(item, Date.parse(data.generatedAt)))}>
                    <span className="admin-activity-icon" aria-hidden>
                      {item.kind === "task_completed" ? <CheckCircle2 size={14} /> : item.kind === "evidence" ? <Camera size={14} /> : item.kind === "eod_submitted" ? <FileCheck2 size={14} /> : item.kind === "recap" ? <Activity size={14} /> : <MessageSquareText size={14} />}
                    </span>
                    <span className="min-w-0">
                      <b>{item.title}</b>
                      <small>{item.personName ?? "Unmapped person"}{item.detail ? ` · ${item.detail}` : ""}</small>
                    </span>
                    <span className="admin-activity-meta">
                      {item.provenance ? <Pill tone="neutral">{statusLabel(item.provenance)}</Pill> : null}
                      <small>{relativeTime(item.at, Date.parse(data.generatedAt))}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-empty-note">No activity has been recorded today yet.</p>
          )}
        </AdminCard>
      </div>

      <AdminCard icon={Database} title="Data sources" detail="Where the record comes from and when each source last delivered" padded={false}>
        <ul className="admin-sources">
          <li>
            <span><ListChecks size={14} aria-hidden /> Tasks</span>
            <small>{data.freshness.niftySyncedAt ? relativeTime(data.freshness.niftySyncedAt, Date.parse(data.generatedAt)) : "never"}</small>
            <b>{data.freshness.niftyTasksToday} task{data.freshness.niftyTasksToday === 1 ? "" : "s"} created today</b>
          </li>
          <li>
            <span><Clock3 size={14} aria-hidden /> Worktivity</span>
            <small>{data.freshness.worktivityObservedAt ? relativeTime(data.freshness.worktivityObservedAt, Date.parse(data.generatedAt)) : "not observed"}</small>
            <b>{counts.evidenceActivityToday} frame{counts.evidenceActivityToday === 1 ? "" : "s"} today</b>
          </li>
          <li>
            <span><Camera size={14} aria-hidden /> GitHub</span>
            <small>{data.freshness.githubLastEventAt ? relativeTime(data.freshness.githubLastEventAt, Date.parse(data.generatedAt)) : "no events"}</small>
            <b>{data.freshness.githubEventsToday} event{data.freshness.githubEventsToday === 1 ? "" : "s"} today</b>
          </li>
          <li>
            <span><Activity size={14} aria-hidden /> Plans</span>
            <small>{data.freshness.lastPlanAt ? relativeTime(data.freshness.lastPlanAt, Date.parse(data.generatedAt)) : "no plan yet"}</small>
            <b>Plan edits and confirmations</b>
          </li>
          <li>
            <span><FileCheck2 size={14} aria-hidden /> EOD reports</span>
            <small>{data.freshness.lastReportSubmittedAt ? relativeTime(data.freshness.lastReportSubmittedAt, Date.parse(data.generatedAt)) : "none submitted"}</small>
            <b>{counts.reportsPendingReview} awaiting review</b>
          </li>
        </ul>
      </AdminCard>

      <p className="admin-disclaimer">
        Activity context is descriptive and never proves attendance, productivity, or task completion. Worktivity owns attendance; Work OS mirrors provider-confirmed state.
      </p>

      <ActivityDetailDrawer
        record={activity}
        onClose={() => setActivity(null)}
        onOpenPerson={onOpenPerson}
        onOpenSection={onOpenSection}
      />
    </div>
  );
}
