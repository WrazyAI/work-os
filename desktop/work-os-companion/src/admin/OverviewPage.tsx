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
import { StackedTimeBars } from "./charts";
import { adminKeys, attendanceLabel, attendanceTone, fetchAdminOverview, formatDuration, relativeTime, statusLabel, todayIso } from "./data";
import { AdminButton, AdminCard, Avatar, Empty, Notice, Pill, Skeleton } from "./ui";
import type { AdminOverview, AdminSection } from "./types";

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

export default function OverviewPage({ onOpenSection, onOpenPerson }: {
  onOpenSection: (section: AdminSection) => void;
  onOpenPerson: (personId: string) => void;
}) {
  const overview = useQuery<AdminOverview>({
    queryKey: adminKeys.overview(todayIso()),
    queryFn: () => fetchAdminOverview(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

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
  const counts = data.counts;
  const people = [...data.people]
    .sort((left, right) => {
      const rank = (person: AdminOverview["people"][number]) => person.attendance.state === "active" ? 0 : person.attendance.state === "paused" ? 1 : person.attendance.state === "off_shift" ? 2 : 3;
      return rank(left) - rank(right) || left.displayName.localeCompare(right.displayName);
    });
  const hasTime = data.timeSeries.some((point) => point.totalMinutes > 0);
  const pendingOldest = counts.pendingReviewOldestAt ? relativeTime(counts.pendingReviewOldestAt, Date.parse(data.generatedAt)) : null;

  return (
    <div className="admin-grid">
      <div className="admin-kpi-strip" aria-label="Today at a glance">
        <KpiCard
          label="On shift now"
          value={String(counts.onShift)}
          detail={counts.paused > 0 ? `${counts.paused} paused · ${counts.people} teammate${counts.people === 1 ? "" : "s"}` : `of ${counts.people} teammate${counts.people === 1 ? "" : "s"}`}
        />
        <KpiCard
          label="Updates today"
          value={String(counts.updatesToday)}
          detail={`${counts.substantiveUpdatesToday} substantive`}
          spark={data.series.map((point) => point.updates)}
          sparkLabel="Recorded updates per day over the last 14 days"
        />
        <KpiCard
          label="Outcomes today"
          value={String(counts.tasksCompletedToday)}
          detail={`${counts.tasksOpen} open · ${counts.tasksOverdue} overdue`}
          spark={data.series.map((point) => point.completed)}
          sparkLabel="Completed outcomes per day over the last 14 days"
        />
        <KpiCard
          label="Awaiting review"
          value={String(counts.reportsPendingReview)}
          detail={counts.reportsPendingReview > 0 && pendingOldest ? `oldest ${pendingOldest}` : "queue is clear"}
        />
        <KpiCard
          label="Evidence today"
          value={String(counts.evidenceToday)}
          detail={`${counts.evidenceOutputToday} output · ${counts.evidenceActivityToday} activity`}
          spark={data.series.map((point) => point.evidence)}
          sparkLabel="Evidence items per day over the last 14 days"
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
          detail={data.attention.length ? "What the record says needs a decision" : undefined}
          action={<AdminButton variant="ghost" icon={FileCheck2} onClick={() => onOpenSection("review")}>Open review</AdminButton>}
        >
          {data.attention.length ? (
            <ul className="admin-attention">
              {data.attention.map((item) => (
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

      <div className="admin-band admin-band-roster">
        <AdminCard
          icon={Users}
          title="Right now"
          detail={`${counts.people} teammate${counts.people === 1 ? "" : "s"} · ${counts.onShift} on shift · ${counts.offShift} off shift · ${counts.unknown} not observed`}
          action={<AdminButton variant="ghost" icon={Users} onClick={() => onOpenSection("people")}>Open People</AdminButton>}
          padded={false}
        >
          {people.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Person</th><th>Status now</th><th>Today</th><th>EOD</th><th>Last update</th></tr>
                </thead>
                <tbody>
                  {people.slice(0, 8).map((person) => (
                    <tr key={person.personId} onClick={() => onOpenPerson(person.personId)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onOpenPerson(person.personId); }}>
                      <td>
                        <span className="admin-person">
                          <Avatar name={person.displayName} size={28} />
                          <span className="min-w-0">
                            <b>{person.displayName}</b>
                            <small>{person.roleProfile ?? "Unmapped role"}{person.schedule ? ` · ${person.schedule.start}–${person.schedule.end}` : " · No schedule"}</small>
                          </span>
                        </span>
                      </td>
                      <td>
                        <Pill tone={attendanceTone(person.attendance.state)}>
                          {attendanceLabel(person.attendance.state)}{person.attendance.freshness === "stale" ? " · stale" : ""}
                        </Pill>
                      </td>
                      <td className="admin-numeric">
                        {person.updatesToday} update{person.updatesToday === 1 ? "" : "s"} · {person.tasksCompletedToday} done{person.evidenceToday ? ` · ${person.evidenceToday} evidence` : ""}
                      </td>
                      <td>
                        {person.eodToday
                          ? <Pill tone={person.eodToday === "approved" ? "ok" : person.eodToday === "pending_review" ? "info" : "neutral"}>{statusLabel(person.eodToday)}</Pill>
                          : person.eodOutstanding ? <Pill tone="warn">Outstanding</Pill> : <span className="admin-quiet">—</span>}
                      </td>
                      <td className="admin-quiet">{person.lastUpdateAt ? relativeTime(person.lastUpdateAt, Date.parse(data.generatedAt)) : "—"}</td>
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
            <span><ListChecks size={14} aria-hidden /> Nifty</span>
            <small>{data.freshness.niftySyncedAt ? relativeTime(data.freshness.niftySyncedAt, Date.parse(data.generatedAt)) : "never"}</small>
            <b>{data.freshness.niftyTasksToday} task{data.freshness.niftyTasksToday === 1 ? "" : "s"} today</b>
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
    </div>
  );
}
