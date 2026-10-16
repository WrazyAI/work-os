"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Clock3, Gauge, ListChecks, Users } from "lucide-react";
import { adminFetch, adminKeys, type AdminInsights, type AdminInsightRange } from "./api";
import { CHART_COLORS, StackedTimeBars, TrendBars } from "./charts";
import {
  AdminCard,
  Avatar,
  Drawer,
  EmptyState,
  Metric,
  Notice,
  SectionHeading,
  SegmentedControl,
  SelectField,
  Skeleton,
  cx,
  formatDuration,
  relativeTime,
  statusLabel,
} from "./ui";

function percent(completed: number, total: number) {
  if (!total) return null;
  return Math.round((completed / total) * 100);
}

function comparison(current: number, previous: number, unit: string) {
  if (current === previous) return `same as the earlier period`;
  const delta = Math.abs(current - previous);
  return `${current > previous ? "up" : "down"} ${delta}${unit} from the earlier period`;
}

export default function AdminInsightsPage() {
  const [range, setRange] = useState<AdminInsightRange>("7d");
  const [personId, setPersonId] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);

  const insights = useQuery<AdminInsights>({
    queryKey: adminKeys.insights(range, personId),
    queryFn: () => {
      const params = new URLSearchParams({ range });
      if (personId) params.set("personId", personId);
      return adminFetch<AdminInsights>(`/api/work-os/admin/insights?${params.toString()}`);
    },
    staleTime: 60_000,
  });

  if (insights.isLoading) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (insights.error || !insights.data) {
    return <Notice tone="err">Insights could not be loaded. {(insights.error as Error | null)?.message}</Notice>;
  }

  const data = insights.data;
  const totals = data.totals;
  const commitment = percent(totals.plannedCompleted, totals.planned);
  const peopleRows = personId ? data.people.filter((row) => row.personId === personId) : data.people;
  const selectedRow = selectedPerson ? data.people.find((row) => row.personId === selectedPerson) ?? null : null;
  const maxAppMinutes = Math.max(1, ...data.topApps.map((app) => app.minutes));
  const hasTimeData = data.timeSeries.some((point) => point.totalMinutes > 0);

  return (
    <div className="grid gap-5">
      {/* Controls + the written brief */}
      <AdminCard padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4">
          <SegmentedControl<AdminInsightRange>
            ariaLabel="Insight range"
            value={range}
            onChange={setRange}
            options={[
              { value: "7d", label: "7 days" },
              { value: "30d", label: "30 days" },
              { value: "90d", label: "90 days" },
            ]}
          />
          <div className="flex items-end gap-2">
            <SelectField
              label="Person"
              value={personId}
              onChange={setPersonId}
              options={data.people.map((row) => ({ value: row.personId, label: row.displayName }))}
              placeholder="All people"
              ariaLabel="Filter insights by person"
            />
          </div>
        </div>
        <div className="border-t px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="text-[13px] leading-6 text-[var(--text-primary)]">{data.notes.summary}</p>
          <div className="mt-3.5 grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-[11.5px] font-semibold text-[var(--text-secondary)]">What the record shows</p>
              <ul className="mt-1.5 grid gap-1.5">
                {data.notes.wins.map((line, index) => (
                  <li key={index} className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: "var(--text-tertiary)" }} />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[11.5px] font-semibold text-[var(--text-secondary)]">Attention</p>
              <ul className="mt-1.5 grid gap-1.5">
                {data.notes.attention.length ? data.notes.attention.map((line, index) => (
                  <li key={index} className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: "var(--status-warn)" }} />
                    {line}
                  </li>
                )) : <li className="text-[12px] text-[var(--text-tertiary)]">Nothing stands out in this range.</li>}
              </ul>
            </div>
            <div>
              <p className="text-[11.5px] font-semibold text-[var(--text-secondary)]">Suggested next focus</p>
              <ul className="mt-1.5 grid gap-1.5">
                {data.notes.nextFocus.map((line, index) => (
                  <li key={index} className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                    <ArrowRight size={12} className="mt-1 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </AdminCard>

      {/* One strip of range facts, never a tile wall */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Metric label="Outcomes completed" value={totals.outcomesCompleted} detail={comparison(totals.outcomesCompleted, data.previous.outcomesCompleted, "")} tone="signal" />
        <Metric label="Commitment rate" value={commitment == null ? "—" : `${commitment}%`} detail={totals.planned ? `${totals.plannedCompleted} of ${totals.planned} planned` : "No confirmed plans"} />
        <Metric label="Active people" value={totals.activePeople} detail={`of ${data.people.length} in scope`} />
        <Metric label="Updates" value={totals.updates} detail={`${totals.substantiveUpdates} substantive`} />
        <Metric label="EOD submitted" value={totals.eodSubmitted} detail={`${totals.eodApproved} approved`} />
        <Metric label="Tracked context" value={totals.trackedMinutes >= 60 ? formatDuration(totals.trackedMinutes * 60) : `${totals.trackedMinutes}m`} detail={comparison(totals.trackedMinutes, data.previous.trackedMinutes, "m")} tone="observed" />
        <Metric label="Sessions to fix" value={totals.sessionsNeedingCorrection} detail={totals.sessionsNeedingCorrection ? "Unresolved time excluded" : "No corrections open"} tone={totals.sessionsNeedingCorrection ? "warn" : "neutral"} />
      </div>

      {/* The range's record: one daily chart beside observed-app context */}
      <div className="grid gap-5 lg:grid-cols-12">
        <AdminCard className="lg:col-span-7">
          <SectionHeading
            icon={Gauge}
            title="Daily record"
            detail={`Completed outcomes, updates, and EOD submissions per day, ${data.from} to ${data.through}.`}
          />
          <TrendBars
            ariaLabel={`Daily completed outcomes, updates, and EOD submissions from ${data.from} to ${data.through}`}
            data={data.series.map((point) => ({
              label: point.date.slice(5).replace("-", "/"),
              outcomesCompleted: point.outcomesCompleted,
              updates: point.updates,
              eodSubmitted: point.eodSubmitted,
            }))}
            series={[
              { key: "outcomesCompleted", label: "Completed outcomes", color: CHART_COLORS.accent },
              { key: "updates", label: "Updates", color: CHART_COLORS.observed },
              { key: "eodSubmitted", label: "EOD submitted", color: CHART_COLORS.neutral },
            ]}
          />
          {data.updateKinds.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-[11.5px] text-[var(--text-secondary)]" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="text-[var(--text-tertiary)]">Update mix</span>
              {data.updateKinds.map((kind) => (
                <span key={kind.kind}>
                  {statusLabel(kind.kind)} <strong className="font-semibold tabular-nums text-[var(--text-primary)]">{kind.count}</strong>
                </span>
              ))}
            </div>
          ) : null}
        </AdminCard>

        <AdminCard className="lg:col-span-5">
          <SectionHeading icon={Activity} title="Observed apps" detail="Neutral activity context from retained frame summaries." />
          {data.topApps.length ? (
            <ul className="grid gap-2.5">
              {data.topApps.map((app) => (
                <li key={app.name} className="grid gap-1">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate text-[var(--text-secondary)]">{app.name}</span>
                    <span className="tabular-nums text-[var(--text-tertiary)]">{app.minutes}m</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--bg-tertiary)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(app.minutes / maxAppMinutes) * 100}%`, background: "var(--status-observed)" }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--text-tertiary)]">No activity context was recorded in this range.</p>
          )}
        </AdminCard>
      </div>

      {/* Observed time for the range beside current backlog pressure */}
      <div className="grid gap-5 lg:grid-cols-12">
        <AdminCard className="lg:col-span-7">
          <SectionHeading
            icon={Clock3}
            title="Time worked"
            detail={`Observed work time per day, split by teammate, ${data.from} to ${data.through}.`}
          />
          {hasTimeData ? (
            <StackedTimeBars
              ariaLabel={`Observed work time per day, split by teammate, from ${data.from} to ${data.through}`}
              data={data.timeSeries}
            />
          ) : (
            <p className="text-[12.5px] text-[var(--text-tertiary)]">No observed work time in this range.</p>
          )}
        </AdminCard>

        <AdminCard className="lg:col-span-5">
          <SectionHeading icon={ListChecks} title="Backlog" detail="Open work recorded across the workspace." />
          {data.overdueOpen == null ? (
            <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">Overdue work is not scoped to this view.</p>
          ) : (
            <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
              <strong className="font-semibold tabular-nums text-[var(--text-primary)]">{data.overdueOpen}</strong> open task{data.overdueOpen === 1 ? "" : "s"} past their due date.
            </p>
          )}
          <Link
            href="/work-os/admin/tasks"
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            Open Tasks <ArrowRight size={12} aria-hidden />
          </Link>
        </AdminCard>
      </div>

      {/* Recorded facts per teammate */}
      <AdminCard padded={false}>
        <div className="px-5 pt-4 pb-2">
          <SectionHeading icon={Users} title="People in this range" detail="Recorded facts per teammate. Activity context is descriptive and never a productivity score." />
        </div>
        {peopleRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[12.5px]">
              <thead>
                <tr className="border-y text-[11px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
                  <th className="px-5 py-2.5 font-medium">Person</th>
                  <th className="px-3 py-2.5 font-medium">Outcomes</th>
                  <th className="px-3 py-2.5 font-medium">Commitment</th>
                  <th className="px-3 py-2.5 font-medium">Updates</th>
                  <th className="px-3 py-2.5 font-medium">EOD</th>
                  <th className="px-3 py-2.5 font-medium">Tracked</th>
                  <th className="px-3 py-2.5 font-medium">Sessions to fix</th>
                  <th className="px-5 py-2.5 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {peopleRows.map((row) => (
                  <tr
                    key={row.personId}
                    tabIndex={0}
                    className="cursor-pointer border-b transition hover:bg-[var(--bg-secondary)]"
                    style={{ borderColor: "var(--border-subtle)" }}
                    onClick={() => setSelectedPerson(row.personId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedPerson(row.personId);
                      }
                    }}
                  >
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={row.displayName} size={28} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-[var(--text-primary)]">{row.displayName}</span>
                          <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{row.roleProfile ?? "Unmapped role"}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{row.outcomesCompleted}{row.outcomesLate ? <span className="text-[var(--status-warn)]"> ({row.outcomesLate} late)</span> : null}</td>
                    <td className="px-3 py-3 tabular-nums">{row.commitmentRate == null ? "—" : `${row.commitmentRate}%`}</td>
                    <td className="px-3 py-3 tabular-nums">{row.updates}</td>
                    <td className="px-3 py-3 tabular-nums">{row.eodSubmitted}</td>
                    <td className="px-3 py-3 tabular-nums">{row.trackedMinutes >= 60 ? formatDuration(row.trackedMinutes * 60) : `${row.trackedMinutes}m`}</td>
                    <td className={cx("px-3 py-3 tabular-nums", row.sessionsNeedingCorrection > 0 && "text-[var(--status-warn)]")}>{row.sessionsNeedingCorrection}</td>
                    <td className="px-5 py-3 text-[11.5px] text-[var(--text-tertiary)]">{row.lastActivityAt ? relativeTime(row.lastActivityAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 pb-5">
            <EmptyState icon={Users} title="No people match this filter" body="Clear the person filter to see the whole workspace." />
          </div>
        )}
      </AdminCard>

      <Drawer
        open={!!selectedRow}
        onClose={() => setSelectedPerson(null)}
        title={selectedRow?.displayName ?? "Person"}
        subtitle={`${data.from} to ${data.through}`}
        width={440}
        footer={
          selectedRow ? (
            <Link
              href={`/work-os/admin/review?personId=${selectedRow.personId}`}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
            >
              Open their EOD reports <ArrowRight size={12} aria-hidden />
            </Link>
          ) : null
        }
      >
        {selectedRow ? (
          <div className="grid gap-4">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5">
              {[
                ["Outcomes completed", String(selectedRow.outcomesCompleted)],
                ["Late outcomes", String(selectedRow.outcomesLate)],
                ["Substantive updates", String(selectedRow.substantiveUpdates)],
                ["Commitment rate", selectedRow.commitmentRate == null ? "—" : `${selectedRow.commitmentRate}%`],
                ["EOD submitted", String(selectedRow.eodSubmitted)],
                ["EOD approved", String(selectedRow.eodApproved)],
                ["Tracked context", selectedRow.trackedMinutes >= 60 ? formatDuration(selectedRow.trackedMinutes * 60) : `${selectedRow.trackedMinutes}m`],
                ["Sessions to fix", String(selectedRow.sessionsNeedingCorrection)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[10.5px] text-[var(--text-tertiary)]">{label}</dt>
                  <dd className="mt-0.5 text-[14px] font-semibold tabular-nums text-[var(--text-primary)]">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[11.5px] leading-5 text-[var(--text-tertiary)]">
              These are recorded facts from the workspace ledger. Observed activity context is not effort, productivity, or completion evidence.
            </p>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
