"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileCheck2,
  MessageSquareText,
  RefreshCw,
} from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { adminFetch, adminKeys, type AdminOverview } from "./api";
import { StackedTimeBars } from "./charts";
import {
  Avatar,
  EmptyState,
  Fact,
  Group,
  Notice,
  Panel,
  Record,
  SectionHeading,
  Skeleton,
  StateMark,
  cx,
  formatDuration,
  relativeTime,
  statusLabel,
} from "./ui";

type ActivityRow = AdminOverview["recentActivity"][number];

const activityIcons = {
  update: MessageSquareText,
  recap: Activity,
  task_completed: CheckCircle2,
  evidence: Camera,
  eod_submitted: FileCheck2,
} as const;

const attentionVerb: Record<string, string> = {
  reports_pending_review: "Review",
  eod_outstanding: "Open queue",
  tasks_overdue: "Open tasks",
  evidence_disputed: "Inspect",
  readiness_blocked: "Fix setup",
};

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

/** The latest records, grouped by the person they belong to. A run of CI
 * events is one line and a count, not twelve near-identical rows; expanding
 * the group still shows every record the workspace holds. */
function activityDigest(rows: ActivityRow[]) {
  const groups = new Map<string, { key: string; name: string; at: string; counts: Map<string, number>; items: ActivityRow[] }>();
  for (const row of rows) {
    const key = row.personId ?? "workspace";
    const label = row.kind === "evidence" && row.provenance === "github"
      ? "GitHub event"
      : row.kind === "task_completed"
        ? "task record"
        : row.kind === "eod_submitted"
          ? "EOD report"
          : row.kind === "recap"
            ? "recap"
            : "update";
    const existing = groups.get(key);
    if (existing) {
      existing.counts.set(label, (existing.counts.get(label) ?? 0) + 1);
      if (row.at > existing.at) existing.at = row.at;
      existing.items.push(row);
      continue;
    }
    groups.set(key, {
      key,
      name: row.personName ?? "Workspace",
      at: row.at,
      counts: new Map([[label, 1]]),
      items: [row],
    });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => right.at.localeCompare(left.at)),
    }))
    .sort((left, right) => right.at.localeCompare(left.at));
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
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
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
  const onShift = people.filter((person) => person.attendance.state === "active" || person.attendance.state === "paused");
  const readiness = data.readiness;
  const hasTimeData = data.timeSeries.some((point) => point.totalMinutes > 0);
  const digest = activityDigest(data.recentActivity);

  return (
    <div className="flex flex-col">
      <Group label="Now" detail="Who is on shift, and how fresh the record is.">
        {onShift.length ? (
          <div className="flex flex-col">
            {onShift.map((person) => {
              const attendance = person.attendance;
              const elapsed = person.session?.observedSeconds ?? 0;
              return (
                <div key={person.personId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b py-3 first:pt-0" style={{ borderColor: "var(--border-subtle)" }}>
                  <div className="flex min-w-0 flex-1 basis-[220px] items-center gap-2.5">
                    <Avatar name={person.displayName} size={26} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--text-primary)]">
                        <span className="min-w-0 truncate">{person.displayName}</span>
                        <StateMark tone={stateTone(attendance.state)}>
                          {stateLabel(attendance.state)}
                          {attendance.freshness === "stale" ? " · stale" : ""}
                        </StateMark>
                      </p>
                      <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                        {person.roleProfile ?? "No role profile"}
                        {person.schedule ? ` · ${person.schedule.start}–${person.schedule.end} ${person.schedule.timezone}` : " · No schedule"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                    <span>{formatDuration(elapsed)}</span>
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
          </div>
        ) : (
          <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
            No one is on shift right now.
          </p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
          <span>
            {data.counts.people} teammate{data.counts.people === 1 ? "" : "s"} · {data.counts.offShift} off shift · {data.counts.unknown} not observed
          </span>
          <Link href="/work-os/admin/people" className="font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
            Open People
          </Link>
        </p>
      </Group>

      <Group label="Decisions" detail="What needs an answer from you today.">
        {data.attention.length ? (
          <ul className="grid">
            {data.attention.map((item) => (
              <li key={item.code} className="border-b last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                <Link
                  href={item.href ?? "#"}
                  className="group flex items-center justify-between gap-3 py-3 transition hover:text-[var(--text-primary)]"
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <span
                      aria-hidden
                      className="mt-[7px] size-1.5 shrink-0 rounded-full"
                      style={{ background: item.severity === "error" ? "var(--status-error)" : item.severity === "warn" ? "var(--status-warn)" : "var(--status-info)" }}
                    />
                    <span className="min-w-0 text-[12.5px] leading-5 text-[var(--text-primary)]">{item.message}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--text-tertiary)] transition group-hover:text-[var(--text-primary)]">
                    {attentionVerb[item.code] ?? "Open"}
                    <ChevronRight size={12} aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
            <CheckCircle2 size={15} style={{ color: "var(--status-ok)" }} aria-hidden />
            Nothing needs a decision right now. Reviews, EODs, and the task record are clear.
          </p>
        )}
      </Group>

      <Group label="Today" detail="Recorded across the workspace so far.">
        <Record columns={4}>
          <Fact label="Completed" value={data.counts.tasksCompletedToday} detail="Task outcomes" tone="signal" lead />
          <Fact label="Updates" value={data.counts.updatesToday} detail={`${data.counts.substantiveUpdatesToday} substantive`} />
          <Fact label="Evidence" value={data.counts.evidenceToday} detail={`${data.counts.evidenceActivityToday} activity · ${data.counts.evidenceOutputToday} output`} tone="observed" />
          <Fact label="EOD submitted" value={data.counts.reportsSubmittedToday} detail={`${data.counts.reportsPendingReview} awaiting review`} />
        </Record>
      </Group>

      <Group label="Record" detail="The latest updates, outcomes, and evidence.">
        {digest.length ? (
          <>
            <div>
              {digest.map((group) => (
                <details key={group.key} className="group border-b last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                    <Avatar name={group.name} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{group.name}</span>
                        <span className="text-[11px] text-[var(--text-tertiary)]">{relativeTime(group.at)}</span>
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-[var(--text-secondary)]">
                        {[...group.counts.entries()].map(([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(" · ")}
                      </span>
                    </span>
                    <ChevronDown size={14} className="shrink-0 text-[var(--text-tertiary)] transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <ol className="mb-3 ml-[38px] border-l pl-4" style={{ borderColor: "var(--border-subtle)" }}>
                    {group.items.slice(0, 12).map((item) => {
                      const Icon = activityIcons[item.kind] ?? Activity;
                      return (
                        <li key={item.id} className="py-2 first:pt-0 last:pb-0">
                          <div className="flex items-start gap-2.5">
                            <Icon size={12} className="mt-[4px] shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                            <div className="min-w-0">
                              <p className="text-[12px] leading-5 text-[var(--text-primary)]">{item.title}</p>
                              {item.detail ? <p className="line-clamp-2 text-[11.5px] leading-[1.5] text-[var(--text-secondary)]">{item.detail}</p> : null}
                              <p className="mt-0.5 text-[10.5px] text-[var(--text-tertiary)]">
                                {relativeTime(item.at)}
                                {item.provenance ? ` · ${item.provenance}` : ""}
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </details>
              ))}
            </div>
            <p className="mt-3 text-[10.5px] leading-4 text-[var(--text-tertiary)]">
              The most recent {data.recentActivity.length} records. Updates and recaps are employee-authored; observed activity is descriptive context.
            </p>
          </>
        ) : (
          <EmptyState icon={Activity} title="No activity recorded yet today" body="Updates, recaps, and completed tasks will appear here as the workspace records them." />
        )}
      </Group>

      <Group label="Time" detail="Observed work time, split by teammate.">
        {hasTimeData ? (
          <Panel padded={false} className="px-4 pb-2 pt-4">
            <StackedTimeBars
              ariaLabel="Observed work time per day for the last 14 days, split by teammate"
              data={data.timeSeries}
            />
          </Panel>
        ) : (
          <p className="text-[12.5px] text-[var(--text-tertiary)]">No observed work time in the last 14 days.</p>
        )}
      </Group>

      <Group label="Setup" detail="Configuration gaps and where each source stands.">
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <div className="min-w-0">
            <SectionHeading
              icon={RefreshCw}
              title="Configuration"
              action={<Link href="/work-os/admin/settings" className="text-[11px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">Open Settings</Link>}
            />
            {readiness ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <StateMark tone={readiness.status === "ready" ? "ok" : readiness.status === "blocked" ? "err" : "warn"}>
                    {statusLabel(readiness.status)}
                  </StateMark>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    {readiness.checks.people.active} people · {readiness.checks.organization.activeTeams} teams · {readiness.checks.tasks.open} open tasks
                  </span>
                </div>
                {readiness.issues.length ? (
                  <ul className="grid gap-1.5 text-[12px] leading-5 text-[var(--text-secondary)]">
                    {readiness.issues.slice(0, 6).map((issue) => (
                      <li key={issue.code} className="flex gap-2">
                        <span
                          aria-hidden
                          className="mt-[7px] size-1.5 shrink-0 rounded-full"
                          style={{ background: issue.severity === "blocked" ? "var(--status-error)" : "var(--status-warn)" }}
                        />
                        <span><strong className="font-semibold text-[var(--text-primary)]">{issue.count}</strong> {issue.message}</span>
                      </li>
                    ))}
                    {readiness.issues.length > 6 ? (
                      <li className="text-[11px] text-[var(--text-tertiary)]">+ {readiness.issues.length - 6} more configuration checks</li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="text-[12px]" style={{ color: "var(--status-ok)" }}>Pilot configuration is complete.</p>
                )}
                <div className="grid gap-1.5 border-t pt-3 text-[11px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
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
          </div>

          <div className="min-w-0">
            <SectionHeading icon={Database} title="Sources" detail="When each source last delivered, measured at generation time." />
            <ul className="grid">
              <SourceRow label="Tasks" at={data.freshness.niftySyncedAt} now={generatedAt} freshWithinMs={60 * 60_000} volume={`${data.freshness.niftyTasksToday} task${data.freshness.niftyTasksToday === 1 ? "" : "s"} created today`} />
              <SourceRow label="Worktivity" at={data.freshness.worktivityObservedAt} now={generatedAt} freshWithinMs={15 * 60_000} volume={`${data.counts.evidenceActivityToday} frame${data.counts.evidenceActivityToday === 1 ? "" : "s"} today`} />
              <SourceRow label="GitHub" at={data.freshness.githubLastEventAt} now={generatedAt} freshWithinMs={24 * 60 * 60_000} volume={`${data.freshness.githubEventsToday} event${data.freshness.githubEventsToday === 1 ? "" : "s"} today`} />
              <SourceRow label="Plans" at={data.freshness.lastPlanAt} now={generatedAt} freshWithinMs={24 * 60 * 60_000} volume="Plan edits and confirmations" />
              <SourceRow label="EOD reports" at={data.freshness.lastReportSubmittedAt} now={generatedAt} freshWithinMs={48 * 60 * 60_000} volume={`${data.counts.reportsPendingReview} awaiting review`} />
            </ul>
          </div>
        </div>
      </Group>

      <p className="mt-6 border-t pt-4 text-[10.5px] leading-4 text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}>
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
      className={cx("flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0")}
      style={{ borderColor: "var(--border-subtle)" }}
      title={at ? `Last data ${new Date(at).toLocaleString()}` : "No data recorded yet"}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="mt-0.5 block text-[10.5px] text-[var(--text-tertiary)]">{volume}</span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">
        {Number.isFinite(parsed) ? relativeTime(at, new Date(now)) : "no data yet"}
      </span>
    </li>
  );
}
