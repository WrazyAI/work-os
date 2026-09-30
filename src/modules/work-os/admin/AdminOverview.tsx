"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock3,
  FileCheck2,
  ListChecks,
  MessageSquareText,
  RefreshCw,
  Users,
} from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { adminFetch, adminKeys, type AdminOverview } from "./api";
import {
  AdminCard,
  Avatar,
  EmptyState,
  Metric,
  Notice,
  ProvenanceChip,
  SectionHeading,
  Skeleton,
  StatusPill,
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
      <div className="grid gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }
  if (overview.error || !overview.data) {
    return <Notice tone="err">The overview could not be loaded. {(overview.error as Error | null)?.message}</Notice>;
  }

  const data = overview.data;
  const people = [...data.people].sort((left, right) => {
    const rank = (person: AdminOverview["people"][number]) => (person.attendance.state === "active" ? 0 : person.attendance.state === "paused" ? 1 : person.attendance.state === "off_shift" ? 2 : 3);
    return rank(left) - rank(right) || left.displayName.localeCompare(right.displayName);
  });
  const visiblePeople = people.slice(0, 10);
  const readiness = data.readiness;

  return (
    <div className="grid gap-5">
      {/* Needs attention */}
      <AdminCard padded={false}>
        <div className="border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <SectionHeading
            icon={AlertTriangle}
            title="Needs attention"
            detail={data.attention.length ? "Items the workspace recorded that need a decision or follow-up." : undefined}
            action={<Link href="/work-os/admin/review" className="text-[11.5px] font-semibold" style={{ color: "var(--accent)" }}>Open review queue</Link>}
          />
          {data.attention.length ? (
            <ul className="grid gap-2">
              {data.attention.map((item) => (
                <li key={item.code}>
                  <Link
                    href={item.href ?? "#"}
                    className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-[12.5px] transition hover:border-[var(--border-hot)]"
                    style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: item.severity === "error" ? "var(--status-error)" : item.severity === "warn" ? "var(--status-warn)" : "var(--status-info)" }}
                      />
                      <span className="min-w-0 text-[var(--text-primary)]">{item.message}</span>
                    </span>
                    <ArrowRight size={14} className="shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
              <CheckCircle2 size={15} style={{ color: "var(--status-ok)" }} aria-hidden />
              Nothing needs attention right now. Reviews, EODs, and the task record are clear.
            </p>
          )}
        </div>
      </AdminCard>

      {/* Right now */}
      <AdminCard>
        <SectionHeading
          icon={Users}
          title="Right now"
          detail={`${data.counts.people} teammate${data.counts.people === 1 ? "" : "s"} · ${data.counts.onShift} on shift · ${data.counts.offShift} off shift · ${data.counts.unknown} not observed`}
          action={<Link href="/work-os/admin/people" className="text-[11.5px] font-semibold" style={{ color: "var(--accent)" }}>Open People</Link>}
        />
        {people.length ? (
          <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {visiblePeople.map((person) => {
              const attendance = person.attendance;
              const elapsed = person.session?.observedSeconds ?? 0;
              return (
                <div key={person.personId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={person.displayName} />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{person.displayName}</p>
                      <p className="truncate text-[11.5px] text-[var(--text-tertiary)]">
                        {person.roleProfile ?? "Unmapped role"}
                        {person.schedule ? ` · ${person.schedule.start}–${person.schedule.end} ${person.schedule.timezone}` : " · No schedule"}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--text-secondary)]">
                    {attendance.state === "active" || attendance.state === "paused" ? (
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Clock3 size={12} aria-hidden style={{ color: "var(--accent)" }} />
                        {formatDuration(elapsed)}
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5">
                      <MessageSquareText size={12} aria-hidden />
                      {person.updatesToday} update{person.updatesToday === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 size={12} aria-hidden />
                      {person.tasksCompletedToday} done
                    </span>
                    {person.eodToday ? (
                      <StatusPill tone={person.eodToday === "approved" ? "ok" : person.eodToday === "pending_review" ? "info" : "neutral"}>
                        EOD {statusLabel(person.eodToday)}
                      </StatusPill>
                    ) : person.eodOutstanding ? (
                      <StatusPill tone="warn">EOD outstanding</StatusPill>
                    ) : null}
                  </div>
                  <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                    <StatusPill tone={stateTone(attendance.state)}>
                      {stateLabel(attendance.state)}
                      {attendance.freshness === "stale" ? " · stale" : ""}
                    </StatusPill>
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
                <Link href="/work-os/admin/people" className="font-semibold" style={{ color: "var(--accent)" }}>See all in People</Link>.
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState icon={Users} title="No active people yet" body="Add people and memberships in Settings to start recording workdays." />
        )}
      </AdminCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Recent activity */}
        <AdminCard>
          <SectionHeading
            icon={Activity}
            title="Recent activity"
            detail="Updates, recaps, completed tasks, evidence, and submissions recorded today."
          />
          {data.recentActivity.length ? (
            <ol className="grid gap-1">
              {data.recentActivity.slice(0, 14).map((item) => {
                const Icon = activityIcons[item.kind] ?? Activity;
                return (
                  <li key={item.id} className="flex gap-3 rounded-xl px-2 py-2.5 transition hover:bg-[var(--bg-secondary)]">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border" style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}>
                      <Icon size={13} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">
                          {item.personName ?? "Workspace"}
                          <span className="ml-2 font-normal text-[var(--text-tertiary)]">{item.title}</span>
                        </p>
                        <span className="text-[10.5px] tabular-nums text-[var(--text-tertiary)]">{relativeTime(item.at)}</span>
                      </div>
                      {item.detail ? <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{item.detail}</p> : null}
                      {item.provenance ? <span className="mt-1 inline-block"><ProvenanceChip>{item.provenance}</ProvenanceChip></span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState icon={Activity} title="No activity recorded yet today" body="Updates, recaps, and completed tasks will appear here as the workspace records them." />
          )}
        </AdminCard>

        <div className="grid content-start gap-5">
          {/* Today at a glance */}
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Completed today" value={data.counts.tasksCompletedToday} detail="Task outcomes" tone="signal" href="/work-os/admin/tasks" />
            <Metric label="Updates" value={data.counts.updatesToday} detail={`${data.counts.substantiveUpdatesToday} substantive`} />
            <Metric label="Evidence" value={data.counts.evidenceToday} detail={`${data.counts.evidenceActivityToday} activity · ${data.counts.evidenceOutputToday} output`} tone="observed" href="/work-os/admin/evidence" />
            <Metric label="EOD submitted" value={data.counts.reportsSubmittedToday} detail={`${data.counts.reportsPendingReview} awaiting review`} href="/work-os/admin/review" />
          </div>

          {/* Workspace health */}
          <AdminCard>
            <SectionHeading
              icon={RefreshCw}
              title="Workspace health"
              detail="Configuration gaps that block the full employee workflow."
              action={<Link href="/work-os/admin/settings" className="text-[11.5px] font-semibold" style={{ color: "var(--accent)" }}>Open Settings</Link>}
            />
            {readiness ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={readiness.status === "ready" ? "ok" : readiness.status === "blocked" ? "err" : "warn"}>
                    {statusLabel(readiness.status)}
                  </StatusPill>
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
                  <p className="text-[12px] text-[var(--status-ok)]">Pilot configuration is complete.</p>
                )}
                <div className="grid gap-1.5 border-t pt-3 text-[11.5px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5"><ListChecks size={12} aria-hidden /> Tasks open</span>
                    <span className="tabular-nums text-[var(--text-secondary)]">{data.counts.tasksOpen} ({data.counts.tasksOverdue} overdue)</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5"><FileCheck2 size={12} aria-hidden /> EOD outstanding</span>
                    <span className="tabular-nums text-[var(--text-secondary)]">{data.counts.eodOutstandingPeople} people · {data.counts.eodOutstandingDays} days</span>
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--text-tertiary)]">Readiness is unavailable right now.</p>
            )}
          </AdminCard>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)]">
        Overview for {formatWorkOsDate(data.date)}. Generated {relativeTime(data.generatedAt)}.
      </p>
    </div>
  );
}
