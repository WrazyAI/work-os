"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  FileCheck2,
  MessageSquareText,
  RefreshCw,
  Users,
} from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { adminFetch, adminKeys, type AdminOverview } from "./api";
import { StackedTimeBars } from "./charts";
import {
  AdminCard,
  Avatar,
  EmptyState,
  Metric,
  Notice,
  PanelLink,
  SectionHeading,
  Skeleton,
  StateMark,
  formatDuration,
  relativeTime,
  statusLabel,
} from "./ui";

const activityIcons = {
  update: MessageSquareText,
  recap: Activity,
  task_completed: CheckCircle2,
  evidence: Camera,
  eod_submitted: FileCheck2,
} as const;

function stateTone(state: AdminOverview["people"][number]["attendance"]["state"]) {
  if (state === "active") return "ok" as const;
  if (state === "paused") return "warn" as const;
  return "neutral" as const;
}

function stateLabel(state: AdminOverview["people"][number]["attendance"]["state"]) {
  if (state === "active") return "On shift";
  if (state === "paused") return "Paused";
  if (state === "off_shift") return "Off shift";
  return "Not observed";
}

export default function AdminOverviewPage() {
  const today = new Date().toISOString().slice(0, 10);
  const overview = useQuery<AdminOverview>({
    queryKey: adminKeys.overview(today),
    queryFn: () => adminFetch<AdminOverview>("/api/work-os/admin/overview"),
    refetchInterval: 60_000,
  });

  if (overview.isLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-12">
        <Skeleton className="h-80 lg:col-span-7" />
        <Skeleton className="h-80 lg:col-span-5" />
        <Skeleton className="h-24 lg:col-span-12" />
        <Skeleton className="h-96 lg:col-span-7" />
        <Skeleton className="h-72 lg:col-span-5" />
      </div>
    );
  }
  if (overview.error || !overview.data) {
    return <Notice tone="err">The overview could not be loaded. {(overview.error as Error | null)?.message}</Notice>;
  }

  const data = overview.data;
  const generatedAt = Date.parse(data.generatedAt);
  const people = [...data.people].sort((left, right) => {
    const rank = (person: AdminOverview["people"][number]) => (person.attendance.state === "active" ? 0 : person.attendance.state === "paused" ? 1 : person.attendance.state === "off_shift" ? 2 : 3);
    return rank(left) - rank(right) || left.displayName.localeCompare(right.displayName);
  });
  const visiblePeople = people.slice(0, 10);
  const readiness = data.readiness;
  const hasTimeData = data.timeSeries.some((point) => point.totalMinutes > 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* Right now — who is working, first in view */}
        <AdminCard className="lg:col-span-7">
          <SectionHeading
            icon={Users}
            title="Right now"
            detail={`${data.counts.people} teammate${data.counts.people === 1 ? "" : "s"} · ${data.counts.onShift} on shift · ${data.counts.offShift} off shift · ${data.counts.unknown} not observed`}
            action={<PanelLink href="/work-os/admin/people" icon={ChevronRight}>Open People</PanelLink>}
          />
          {people.length ? (
            <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {visiblePeople.map((person) => {
                const attendance = person.attendance;
                const elapsed = person.session?.observedSeconds ?? 0;
                return (
                  <div key={person.personId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3 first:pt-1 last:pb-1">
                    <div className="flex min-w-0 flex-1 basis-[210px] items-center gap-2.5">
                      <Avatar name={person.displayName} size={26} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--text-primary)]">
                          <span className="min-w-0 truncate">{person.displayName}</span>
                          <StateMark tone={stateTone(attendance.state)}>
                            {stateLabel(attendance.state)}
                            {attendance.freshness === "stale" ? " · stale" : ""}
                          </StateMark>
                        </p>
                        <p className="truncate text-[11.5px] text-[var(--text-tertiary)]">
                          {person.roleProfile ?? "Unmapped role"}
                          {person.schedule ? ` · ${person.schedule.start}–${person.schedule.end} ${person.schedule.timezone}` : " · No schedule"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                      {attendance.state === "active" || attendance.state === "paused" ? <span>{formatDuration(elapsed)}</span> : null}
                      <span>{person.updatesToday} update{person.updatesToday === 1 ? "" : "s"}</span>
                      <span>{person.tasksCompletedToday} done</span>
                    </div>
                    <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                      {person.eodToday ? (
                        <StateMark tone={person.eodToday === "approved" ? "ok" : person.eodToday === "pending_review" ? "info" : "neutral"}>
                          EOD {statusLabel(person.eodToday)}
                        </StateMark>
                      ) : person.eodOutstanding ? (
                        <StateMark tone="warn">EOD outstanding</StateMark>
                      ) : null}
                      <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                        {person.lastUpdateAt ? `last update ${relativeTime(person.lastUpdateAt)}` : "no update today"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {people.length > visiblePeople.length ? (
                <p className="pt-3 text-[11.5px] text-[var(--text-tertiary)]">
                  Showing {visiblePeople.length} of {people.length} teammates.{" "}
                  <Link href="/work-os/admin/people" className="font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">See all in People</Link>.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState icon={Users} title="No active people yet" body="Add people and memberships in Settings to start recording workdays." />
          )}
        </AdminCard>

        {/* Needs attention — flat hairline rows, one link each */}
        <AdminCard padded={false} className="lg:col-span-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-3.5" style={{ borderColor: "var(--border-subtle)" }}>
            <h2 className="flex items-center gap-2 text-[14.5px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              <AlertTriangle size={14} className="shrink-0" style={{ color: "var(--text-tertiary)" }} aria-hidden />
              Needs attention
            </h2>
            <PanelLink href="/work-os/admin/review" icon={ChevronRight}>Open review queue</PanelLink>
          </div>
          {data.attention.length ? (
            <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {data.attention.map((item) => (
                <li key={item.code}>
                  <Link
                    href={item.href ?? "#"}
                    className="flex items-center justify-between gap-3 px-5 py-3 text-[12.5px] transition hover:bg-[var(--bg-secondary)]"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: item.severity === "error" ? "var(--status-error)" : item.severity === "warn" ? "var(--status-warn)" : "var(--status-info)" }}
                      />
                      <span className="min-w-0 text-[var(--text-primary)]">{item.message}</span>
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 px-5 py-4 text-[12.5px] text-[var(--text-secondary)]">
              <CheckCircle2 size={15} style={{ color: "var(--status-ok)" }} aria-hidden />
              Nothing needs attention right now. Reviews, EODs, and the task record are clear.
            </p>
          )}
        </AdminCard>

        {/* Today's counts — one quiet strip of four facts */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:col-span-12">
          <Metric label="Completed today" value={data.counts.tasksCompletedToday} detail="Task outcomes" tone="signal" href="/work-os/admin/tasks" />
          <Metric label="Updates" value={data.counts.updatesToday} detail={`${data.counts.substantiveUpdatesToday} substantive`} />
          <Metric label="Evidence" value={data.counts.evidenceToday} detail={`${data.counts.evidenceActivityToday} activity · ${data.counts.evidenceOutputToday} output`} tone="observed" href="/work-os/admin/evidence" />
          <Metric label="EOD submitted" value={data.counts.reportsSubmittedToday} detail={`${data.counts.reportsPendingReview} awaiting review`} href="/work-os/admin/review" />
        </div>

        {/* Recent activity — flat rows, no icon discs, no badge chips */}
        <AdminCard className="lg:col-span-7">
          <SectionHeading
            icon={Activity}
            title="Recent activity"
            detail="Updates, recaps, completed tasks, evidence, and submissions recorded today."
          />
          {data.recentActivity.length ? (
            <ol className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {data.recentActivity.slice(0, 14).map((item) => {
                const Icon = activityIcons[item.kind] ?? Activity;
                return (
                  <li key={item.id} className="flex items-start gap-3 py-3 first:pt-1 last:pb-1">
                    <Icon size={13} className="mt-[3px] shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <p className="min-w-0 text-[12.5px] leading-5 text-[var(--text-primary)]">
                          <span className="font-semibold">{item.personName ?? "Workspace"}</span>{" "}
                          <span className="text-[var(--text-secondary)]">{item.title}</span>
                        </p>
                        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">{relativeTime(item.at)}</span>
                      </div>
                      {item.detail || item.provenance ? (
                        <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                          {item.detail}
                          {item.provenance ? (
                            <span className="text-[var(--text-tertiary)]">{item.detail ? " — " : ""}{item.provenance}</span>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState icon={Activity} title="No activity recorded yet today" body="Updates, recaps, and completed tasks will appear here as the workspace records them." />
          )}
        </AdminCard>

        {/* Workspace health — one status line, issues, two facts */}
        <AdminCard className="lg:col-span-5">
          <SectionHeading
            icon={RefreshCw}
            title="Workspace health"
            detail="Configuration gaps that block the full employee workflow."
            action={<PanelLink href="/work-os/admin/settings" icon={ChevronRight}>Open Settings</PanelLink>}
          />
          {readiness ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StateMark tone={readiness.status === "ready" ? "ok" : readiness.status === "blocked" ? "err" : "warn"}>
                  {statusLabel(readiness.status)}
                </StateMark>
                <span className="text-[11.5px] text-[var(--text-tertiary)]">
                  {readiness.checks.people.active} people · {readiness.checks.organization.activeTeams} teams · {readiness.checks.tasks.open} open tasks
                </span>
              </div>
              {readiness.issues.length ? (
                <ul className="grid gap-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                  {readiness.issues.slice(0, 4).map((issue) => (
                    <li key={issue.code} className="flex gap-2">
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full"
                        style={{ background: issue.severity === "blocked" ? "var(--status-error)" : "var(--status-warn)" }}
                      />
                      <span><strong className="font-semibold text-[var(--text-primary)]">{issue.count}</strong> {issue.message}</span>
                    </li>
                  ))}
                  {readiness.issues.length > 4 ? (
                    <li className="text-[11.5px] text-[var(--text-tertiary)]">+ {readiness.issues.length - 4} more configuration checks</li>
                  ) : null}
                </ul>
              ) : (
                <p className="text-[12px]" style={{ color: "var(--status-ok)" }}>Pilot configuration is complete.</p>
              )}
              <div className="grid gap-1.5 border-t pt-3 text-[11.5px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
                <span className="flex items-center justify-between gap-2">
                  <span>Tasks open</span>
                  <span className="tabular-nums text-[var(--text-secondary)]">{data.counts.tasksOpen} ({data.counts.tasksOverdue} overdue)</span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span>EOD outstanding</span>
                  <span className="tabular-nums text-[var(--text-secondary)]">{data.counts.eodOutstandingPeople} people · {data.counts.eodOutstandingDays} days</span>
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--text-tertiary)]">Readiness is unavailable right now.</p>
          )}
        </AdminCard>

        {/* Time worked — the range's observed time, quiet context at the close */}
        <AdminCard className="lg:col-span-7">
          <SectionHeading icon={Clock3} title="Time worked" detail="Observed work time per day, split by teammate." />
          {hasTimeData ? (
            <StackedTimeBars
              ariaLabel="Observed work time per day for the last 14 days, split by teammate"
              data={data.timeSeries}
            />
          ) : (
            <p className="text-[12.5px] text-[var(--text-tertiary)]">No observed work time in the last 14 days.</p>
          )}
        </AdminCard>

        {/* Data sources — flat freshness rows */}
        <AdminCard className="lg:col-span-5">
          <SectionHeading icon={Database} title="Data sources" detail="When each source last delivered and today's volume." />
          <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            <SourceRow label="Tasks" at={data.freshness.niftySyncedAt} now={generatedAt} freshWithinMs={60 * 60_000} volume={`${data.freshness.niftyTasksToday} task${data.freshness.niftyTasksToday === 1 ? "" : "s"} created today`} />
            <SourceRow label="Worktivity" at={data.freshness.worktivityObservedAt} now={generatedAt} freshWithinMs={15 * 60_000} volume={`${data.counts.evidenceActivityToday} frame${data.counts.evidenceActivityToday === 1 ? "" : "s"} today`} />
            <SourceRow label="GitHub" at={data.freshness.githubLastEventAt} now={generatedAt} freshWithinMs={24 * 60 * 60_000} volume={`${data.freshness.githubEventsToday} event${data.freshness.githubEventsToday === 1 ? "" : "s"} today`} />
            <SourceRow label="Plans" at={data.freshness.lastPlanAt} now={generatedAt} freshWithinMs={24 * 60 * 60_000} volume="Plan edits and confirmations" />
            <SourceRow label="EOD reports" at={data.freshness.lastReportSubmittedAt} now={generatedAt} freshWithinMs={48 * 60 * 60_000} volume={`${data.counts.reportsPendingReview} awaiting review`} />
          </ul>
        </AdminCard>
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)]">
        Overview for {formatWorkOsDate(data.date)}. Generated {relativeTime(data.generatedAt)}.
      </p>
    </div>
  );
}

/** One source row: name, today's volume, and a freshness dot measured
 * against the payload's generation time so a render stays deterministic. */
function SourceRow({ label, at, now, freshWithinMs, volume }: { label: string; at: string | null; now: number; freshWithinMs: number; volume: string }) {
  const parsed = at ? Date.parse(at) : Number.NaN;
  const age = Number.isFinite(parsed) ? now - parsed : Number.POSITIVE_INFINITY;
  const tone = !Number.isFinite(age) ? "none" : age <= freshWithinMs ? "fresh" : age <= freshWithinMs * 3 ? "stale" : "cold";
  const color = tone === "fresh" ? "var(--status-ok)" : tone === "stale" ? "var(--status-warn)" : "var(--text-tertiary)";
  return (
    <li
      className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
      title={at ? `Last data ${new Date(at).toLocaleString()}` : "No data recorded yet"}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-primary)]">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] text-[var(--text-tertiary)]">{volume}</span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">
        {Number.isFinite(parsed) ? relativeTime(at, new Date(now)) : "no data yet"}
      </span>
    </li>
  );
}
