"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Gauge, ListChecks, Users } from "lucide-react";
import { adminFetch, adminKeys, type AdminInsights, type AdminInsightRange } from "./api";
import { StackedTimeBars, TrendBars } from "./charts";
import {
  Avatar,
  Drawer,
  EmptyState,
  Fact,
  Group,
  Notice,
  Panel,
  Record,
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

/** The three series read as one record: ink for outcomes, muted for updates,
 * cool observation for submissions. Green stays reserved for state. */
const SERIES = [
  { key: "outcomesCompleted", label: "Completed outcomes", color: "var(--text-primary)" },
  { key: "updates", label: "Updates", color: "var(--text-tertiary)" },
  { key: "eodSubmitted", label: "EOD submitted", color: "var(--status-observed)" },
] as const;

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
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
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
    <div className="flex flex-col">
      <Group label="Brief" detail="Recorded facts first. Activity context is never a score.">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5">
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
          <SelectField
            label="Person"
            value={personId}
            onChange={setPersonId}
            options={data.people.map((row) => ({ value: row.personId, label: row.displayName }))}
            placeholder="All people"
            ariaLabel="Filter insights by person"
          />
        </div>
        <p className="max-w-[72ch] text-[13.5px] leading-[1.7] text-[var(--text-primary)]">{data.notes.summary}</p>
        <div className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold text-[var(--text-secondary)]">What the record shows</p>
            <ul className="mt-1.5 grid gap-1.5">
              {data.notes.wins.map((line, index) => (
                <li key={index} className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                  <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: "var(--text-tertiary)" }} />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-[var(--text-secondary)]">Attention</p>
            <ul className="mt-1.5 grid gap-1.5">
              {data.notes.attention.length ? data.notes.attention.map((line, index) => (
                <li key={index} className="flex gap-2 text-[12px] leading-5 text-[var(--text-secondary)]">
                  <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: "var(--status-warn)" }} />
                  {line}
                </li>
              )) : <li className="text-[12px] text-[var(--text-tertiary)]">Nothing stands out in this range.</li>}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-[var(--text-secondary)]">Suggested next focus</p>
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
      </Group>

      <Group label="Facts" detail={`One record for ${data.from} to ${data.through}.`}>
        <Record columns={4}>
          <Fact label="Outcomes completed" value={totals.outcomesCompleted} detail={comparison(totals.outcomesCompleted, data.previous.outcomesCompleted, "")} tone="signal" lead />
          <Fact label="Commitment rate" value={commitment == null ? "—" : `${commitment}%`} detail={totals.planned ? `${totals.plannedCompleted} of ${totals.planned} planned` : "No confirmed plans"} />
          <Fact label="Active people" value={totals.activePeople} detail={`of ${data.people.length} in scope`} />
          <Fact label="EOD submitted" value={totals.eodSubmitted} detail={`${totals.eodApproved} approved`} />
        </Record>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
          <span>
            Updates <strong className="font-semibold tabular-nums text-[var(--text-secondary)]">{totals.updates}</strong> ({totals.substantiveUpdates} substantive)
          </span>
          <span>
            Tracked context <strong className="font-semibold tabular-nums text-[var(--text-secondary)]">{totals.trackedMinutes >= 60 ? formatDuration(totals.trackedMinutes * 60) : `${totals.trackedMinutes}m`}</strong> · {comparison(totals.trackedMinutes, data.previous.trackedMinutes, "m")}
          </span>
          <span className={totals.sessionsNeedingCorrection ? "text-[var(--status-warn)]" : undefined}>
            Sessions to fix <strong className="font-semibold tabular-nums">{totals.sessionsNeedingCorrection}</strong>
          </span>
        </p>
      </Group>

      <Group label="GHL evidence" detail="Provider-recorded activity in this range, separate from task outcomes.">
        <Record columns={3}>
          <Fact label="Performed by employees" value={data.ghl.performed} detail="Verified mapped actions with a provider occurrence time" tone="observed" />
          <Fact label="Context only" value={data.ghl.contextTotal} detail="Shared, automated, assigned or unknown; not credited" />
          <Fact label="Last sync" value={data.ghl.lastSyncedAt ? relativeTime(data.ghl.lastSyncedAt) : "—"} detail={data.ghl.connected ? statusLabel(data.ghl.state) : "Not connected"} />
        </Record>
        <p className="mt-3 text-[11px] leading-5 text-[var(--text-tertiary)]">
          {data.ghl.coverage.length
            ? data.ghl.coverage.map((entry) => `${entry.kind} ${entry.state}${entry.capped ? " (capped)" : ""}`).join(" · ")
            : "No GHL coverage has been recorded for this range."}
        </p>
      </Group>

      <Group label="Daily record" detail="Completed outcomes, updates, and submissions.">
        <Panel>
          <TrendBars
            ariaLabel={`Daily completed outcomes, updates, and EOD submissions from ${data.from} to ${data.through}`}
            data={data.series.map((point) => ({
              label: point.date.slice(5).replace("-", "/"),
              outcomesCompleted: point.outcomesCompleted,
              updates: point.updates,
              eodSubmitted: point.eodSubmitted,
            }))}
            series={[...SERIES]}
          />
          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-[var(--text-tertiary)]">
            {SERIES.map((series) => (
              <li key={series.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-[2px]" style={{ background: series.color }} />
                {series.label}
              </li>
            ))}
          </ul>
          {data.updateKinds.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-[11px] text-[var(--text-secondary)]" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="text-[var(--text-tertiary)]">Update mix</span>
              {data.updateKinds.map((kind) => (
                <span key={kind.kind}>
                  {statusLabel(kind.kind)} <strong className="font-semibold tabular-nums text-[var(--text-primary)]">{kind.count}</strong>
                </span>
              ))}
            </div>
          ) : null}
        </Panel>
      </Group>

      <Group label="Context" detail="Observed apps and current backlog pressure.">
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <div className="min-w-0">
            <SectionHeading icon={Activity} title="Observed apps" detail="Neutral context from retained frame summaries." />
            {data.topApps.length ? (
              <ul className="grid gap-2.5">
                {data.topApps.map((app) => (
                  <li key={app.name} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="truncate text-[var(--text-secondary)]">{app.name}</span>
                      <span className="tabular-nums text-[var(--text-tertiary)]">{app.minutes}m</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full" style={{ background: "var(--bg-tertiary)" }}>
                      <div className="h-full rounded-full" style={{ width: `${(app.minutes / maxAppMinutes) * 100}%`, background: "var(--status-observed)" }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[var(--text-tertiary)]">No activity context was recorded in this range.</p>
            )}
          </div>

          <div className="min-w-0">
            <SectionHeading icon={ListChecks} title="Backlog" detail="Open work recorded across the workspace." />
            {data.overdueOpen == null ? (
              <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">Overdue work is not scoped to this view.</p>
            ) : (
              <p className="text-[12.5px] leading-5 text-[var(--text-secondary)]">
                <strong className="text-[22px] font-[590] tracking-[-0.03em] tabular-nums text-[var(--text-primary)]">{data.overdueOpen}</strong>
                <span className="ml-2">open task{data.overdueOpen === 1 ? "" : "s"} past their due date.</span>
              </p>
            )}
            <Link
              href="/work-os/admin/tasks"
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
            >
              Open Tasks <ArrowRight size={12} aria-hidden />
            </Link>
            <div className="mt-4">
              <SectionHeading icon={Gauge} title="Time worked" detail="Observed per day, split by teammate." />
              {hasTimeData ? (
                <StackedTimeBars
                  ariaLabel={`Observed work time per day, split by teammate, from ${data.from} to ${data.through}`}
                  data={data.timeSeries}
                />
              ) : (
                <p className="text-[12.5px] text-[var(--text-tertiary)]">No observed work time in this range.</p>
              )}
            </div>
          </div>
        </div>
      </Group>

      <Group label="People" detail="Recorded facts per teammate in this range.">
        {peopleRows.length ? (
          <Panel padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead>
                  <tr className="border-b text-[10.5px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}>
                    <th className="px-4 py-2.5 font-medium">Person</th>
                    <th className="px-3 py-2.5 font-medium">Outcomes</th>
                    <th className="px-3 py-2.5 font-medium">Commitment</th>
                    <th className="px-3 py-2.5 font-medium">Updates</th>
                    <th className="px-3 py-2.5 font-medium">EOD</th>
                    <th className="px-3 py-2.5 font-medium">Tracked</th>
                    <th className="px-3 py-2.5 font-medium">Sessions to fix</th>
                    <th className="px-4 py-2.5 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {peopleRows.map((row) => (
                    <tr
                      key={row.personId}
                      tabIndex={0}
                      className="cursor-pointer border-b transition last:border-b-0 hover:bg-[var(--bg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
                      style={{ borderColor: "var(--border-subtle)" }}
                      onClick={() => setSelectedPerson(row.personId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedPerson(row.personId);
                        }
                      }}
                    >
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={row.displayName} size={26} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-[var(--text-primary)]">{row.displayName}</span>
                            <span className="block truncate text-[10.5px] text-[var(--text-tertiary)]">{row.roleProfile ?? "No role profile"}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{row.outcomesCompleted}{row.outcomesLate ? <span className="text-[var(--status-warn)]"> ({row.outcomesLate} late)</span> : null}</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.commitmentRate == null ? "—" : `${row.commitmentRate}%`}</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.updates}</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.eodSubmitted}</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.trackedMinutes >= 60 ? formatDuration(row.trackedMinutes * 60) : `${row.trackedMinutes}m`}</td>
                      <td className={cx("px-3 py-2.5 tabular-nums", row.sessionsNeedingCorrection > 0 && "text-[var(--status-warn)]")}>{row.sessionsNeedingCorrection}</td>
                      <td className="px-4 py-2.5 text-[10.5px] text-[var(--text-tertiary)]">{row.lastActivityAt ? relativeTime(row.lastActivityAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <EmptyState icon={Users} title="No people match this filter" body="Clear the person filter to see the whole workspace." />
        )}
      </Group>

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
