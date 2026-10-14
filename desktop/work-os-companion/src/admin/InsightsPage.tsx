import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Gauge, RefreshCw, Sparkles, Users } from "lucide-react";
import { KpiCard, PlanReliability, type ReliabilityRow } from "../InsightCharts";
import type { DeltaStat } from "../insights";
import { GroupedBars, ShareBars, StackedTimeBars } from "./charts";
import { adminKeys, ADMIN_STALE_MS, fetchAdminInsights, formatMinutes, relativeTime, shortDate, statusLabel } from "./data";
import { AdminButton, AdminCard, Avatar, Drawer, Notice, Pill, Segmented, SelectField, Skeleton } from "./ui";
import type { AdminInsights, AdminInsightPersonRow, AdminInsightRange } from "./types";

function deltaStat(key: string, label: string, current: number, previous: number, unit: DeltaStat["unit"], goodDirection: boolean): DeltaStat {
  return { key, label, current, previous, delta: current - previous, unit, goodDirection };
}

/** Organization insights: a written brief, a metric strip with equal-earlier-
 * period comparisons, the range's shape, and the per-person record behind it.
 * Observed activity stays context; nothing here is a productivity score. */
export default function InsightsPage({ initialPersonId }: { initialPersonId?: string }) {
  const [range, setRange] = useState<AdminInsightRange>("7d");
  const [personId, setPersonId] = useState(initialPersonId ?? "");
  const [selectedRow, setSelectedRow] = useState<AdminInsightPersonRow | null>(null);

  const insights = useQuery<AdminInsights>({
    queryKey: adminKeys.insights(range, personId),
    queryFn: () => fetchAdminInsights(range, personId),
    staleTime: ADMIN_STALE_MS,
  });

  if (insights.isLoading) {
    return (
      <div className="admin-grid">
        <Skeleton className="h-28" />
        <div className="admin-kpi-strip">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[104px]" />)}</div>
        <Skeleton className="h-64" />
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (insights.error || !insights.data) {
    return (
      <Notice tone="err">
        Insights could not be loaded.
        <AdminButton variant="ghost" icon={RefreshCw} onClick={() => void insights.refetch()}>Retry</AdminButton>
      </Notice>
    );
  }

  const data = insights.data;
  const { totals, previous } = data;
  const rows = personId ? data.people.filter((row) => row.personId === personId) : data.people;
  const commitment = totals.planned > 0 ? Math.round((totals.plannedCompleted / totals.planned) * 100) : null;
  const previousCommitment = previous.planned > 0 ? Math.round((previous.plannedCompleted / previous.planned) * 100) : null;
  const reliabilityRows: ReliabilityRow[] = [
    {
      key: "commitment",
      label: "Commitments landed",
      percent: commitment,
      detail: totals.planned > 0 ? `${totals.plannedCompleted} of ${totals.planned} planned items` : "No planned items in this range",
    },
    {
      key: "on-time",
      label: "Outcomes on time",
      percent: totals.outcomesCompleted + totals.outcomesLate > 0 ? Math.round((totals.outcomesCompleted / (totals.outcomesCompleted + totals.outcomesLate)) * 100) : null,
      detail: `${totals.outcomesLate} late of ${totals.outcomesCompleted + totals.outcomesLate} dated outcomes`,
    },
    {
      key: "active",
      label: "People with recorded work",
      percent: totals.activePeople > 0 && totals.activePeople <= data.people.length ? Math.round((totals.activePeople / Math.max(1, data.people.length)) * 100) : null,
      detail: `${totals.activePeople} of ${data.people.length} people recorded outcomes, updates, tracked time, or an EOD`,
    },
  ];
  const selected = selectedRow;

  return (
    <div className="admin-grid">
      <AdminCard
        icon={Gauge}
        title="Brief"
        detail={`${shortDate(`${data.from}T12:00:00Z`)} – ${shortDate(`${data.through}T12:00:00Z`)} · generated ${relativeTime(data.freshness.generatedAt)}`}
        action={
          <div className="admin-toolbar">
            <Segmented<AdminInsightRange>
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
              ariaLabel="Filter insights by person"
              value={personId}
              onChange={setPersonId}
              placeholder="All people"
              options={data.people.map((row) => ({ value: row.personId, label: row.displayName }))}
            />
            {data.overdueOpen ? <Pill tone="warn">{data.overdueOpen} open overdue</Pill> : null}
          </div>
        }
      >
        <p className="admin-brief-lead">{data.notes.summary}</p>
        <div className="admin-brief-columns">
          <div>
            <h3>What the record shows</h3>
            <ul>
              {data.notes.wins.map((line, index) => <li key={index}><span className="admin-dot ok" aria-hidden />{line}</li>)}
            </ul>
          </div>
          <div>
            <h3>Attention</h3>
            {data.notes.attention.length ? (
              <ul>
                {data.notes.attention.map((line, index) => <li key={index}><span className="admin-dot warn" aria-hidden />{line}</li>)}
              </ul>
            ) : (
              <p className="admin-quiet">Nothing the record flagged in this range.</p>
            )}
          </div>
          <div>
            <h3>Next focus</h3>
            <ul>
              {data.notes.nextFocus.map((line, index) => <li key={index}><Sparkles size={12} aria-hidden />{line}</li>)}
            </ul>
          </div>
        </div>
      </AdminCard>

      <div className="admin-kpi-strip" aria-label="Range measurements">
        <KpiCard
          label="Outcomes completed"
          value={String(totals.outcomesCompleted)}
          delta={deltaStat("outcomes", "Outcomes completed", totals.outcomesCompleted, previous.outcomesCompleted, "count", true)}
          spark={data.series.map((point) => point.outcomesCompleted)}
          sparkLabel="Completed outcomes per day in this range"
        />
        <KpiCard
          label="Substantive updates"
          value={String(totals.substantiveUpdates)}
          delta={deltaStat("updates", "Updates", totals.updates, previous.updates, "count", true)}
          spark={data.series.map((point) => point.updates)}
          sparkLabel="Recorded updates per day in this range"
        />
        <KpiCard
          label="EOD reports submitted"
          value={String(totals.eodSubmitted)}
          delta={deltaStat("eod", "EOD submitted", totals.eodSubmitted, previous.eodSubmitted, "count", true)}
          spark={data.series.map((point) => point.eodSubmitted)}
          sparkLabel="Submitted EOD reports per day in this range"
        />
        <KpiCard
          label="Late outcomes"
          value={String(totals.outcomesLate)}
          delta={deltaStat("late", "Late outcomes", totals.outcomesLate, previous.outcomesLate, "count", false)}
          attention={totals.outcomesLate > 0}
          detail={totals.outcomesLate ? "Completed after their recorded due date" : "Nothing landed late"}
        />
        <KpiCard
          label="Tracked context"
          value={formatMinutes(totals.trackedMinutes)}
          delta={deltaStat("tracked", "Tracked context", totals.trackedMinutes, previous.trackedMinutes, "minutes", true)}
          detail="App and site observation, never a score"
        />
      </div>

      <div className="admin-band">
        <AdminCard icon={Activity} title="Activity per day" detail="Recorded outcomes, updates, and submitted EOD reports">
          <GroupedBars
            ariaLabel="Recorded outcomes, updates, and submitted EOD reports per day in this range"
            points={data.series.map((point) => ({
              label: shortDate(`${point.date}T12:00:00Z`),
              values: { outcomes: point.outcomesCompleted, updates: point.updates, eod: point.eodSubmitted },
            }))}
            series={[
              { key: "outcomes", label: "Outcomes", color: "var(--ink)" },
              { key: "updates", label: "Updates", color: "#82bd39" },
              { key: "eod", label: "EOD reports", color: "#2e617d" },
            ]}
          />
        </AdminCard>
        <AdminCard icon={AlertTriangle} title="Plan reliability" detail="Recorded ratios from this range">
          <PlanReliability rows={reliabilityRows} />
          <p className="admin-quiet">Ratios come from the recorded plan and the task record; they are never targets set for a person.</p>
        </AdminCard>
      </div>

      <AdminCard icon={Activity} title="Time worked" detail="Observed work time per day, split by teammate" padded={false}>
        <div className="admin-card-body is-padded">
          <StackedTimeBars ariaLabel="Observed work time per day in this range, split by teammate" points={data.timeSeries} />
        </div>
      </AdminCard>

      <div className="admin-band admin-band-facts">
        <AdminCard icon={Users} title="Per-person record" detail={`${rows.length} people · select a row for the full facts`} padded={false}>
          {rows.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Person</th><th>Outcomes</th><th>Late</th><th>Updates</th><th>Commitment</th><th>EOD</th><th>Tracked</th><th>Last activity</th></tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.personId} onClick={() => setSelectedRow(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelectedRow(row); }}>
                      <td>
                        <span className="admin-person">
                          <Avatar name={row.displayName} size={26} />
                          <span className="min-w-0"><b>{row.displayName}</b><small>{row.roleProfile ?? "Unmapped role"}</small></span>
                        </span>
                      </td>
                      <td className="admin-numeric">{row.outcomesCompleted}</td>
                      <td className={row.outcomesLate ? "admin-numeric warn" : "admin-numeric"}>{row.outcomesLate}</td>
                      <td className="admin-numeric">{row.updates}</td>
                      <td className="admin-numeric">{row.commitmentRate != null ? `${row.commitmentRate}%` : "—"}</td>
                      <td className="admin-numeric">{row.eodSubmitted}</td>
                      <td className="admin-numeric">{row.trackedMinutes ? formatMinutes(row.trackedMinutes) : "—"}</td>
                      <td className="admin-quiet">{row.lastActivityAt ? relativeTime(row.lastActivityAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-card-body is-padded"><p className="admin-empty-note">No people are in scope for this range.</p></div>
          )}
        </AdminCard>

        <AdminCard icon={Activity} title="What filled the range" detail="Update kinds and the app context behind tracked time">
          <h4 className="admin-subhead">Update kinds</h4>
          <ShareBars ariaLabel="Recorded updates by kind" items={data.updateKinds.map((entry) => ({ label: statusLabel(entry.kind), value: entry.count }))} />
          <h4 className="admin-subhead">Top apps and sites</h4>
          <ShareBars ariaLabel="Tracked app and site minutes, strongest first" items={data.topApps.map((entry) => ({ label: entry.name, value: Math.round(entry.minutes), note: "minutes" }))} />
          {!data.updateKinds.length && !data.topApps.length ? <p className="admin-empty-note">Nothing was recorded in this range yet.</p> : null}
        </AdminCard>
      </div>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedRow(null)}
        title={selected?.displayName ?? "Person"}
        subtitle={selected ? `${selected.roleProfile ?? "Unmapped role"} · ${shortDate(`${data.from}T12:00:00Z`)} – ${shortDate(`${data.through}T12:00:00Z`)}` : undefined}
        width={520}
      >
        {selected ? (
          <div className="admin-grid admin-drawer-grid">
            <section className="admin-block">
              <h3>Recorded outcomes</h3>
              <div className="admin-kv-grid">
                <div className="admin-kv"><span>Completed</span><b>{selected.outcomesCompleted}</b></div>
                <div className="admin-kv"><span>Late</span><b className={selected.outcomesLate ? "is-warn" : undefined}>{selected.outcomesLate}</b></div>
                <div className="admin-kv"><span>Updates</span><b>{selected.updates}</b></div>
                <div className="admin-kv"><span>Substantive</span><b>{selected.substantiveUpdates}</b></div>
                <div className="admin-kv"><span>EOD submitted</span><b>{selected.eodSubmitted}</b></div>
                <div className="admin-kv"><span>Tracked context</span><b>{selected.trackedMinutes ? formatMinutes(selected.trackedMinutes) : "—"}</b></div>
                <div className="admin-kv"><span>Output evidence</span><b>{selected.evidenceOutput}</b></div>
                <div className="admin-kv"><span>Activity evidence</span><b>{selected.evidenceActivity}</b></div>
              </div>
            </section>
            <section className="admin-block">
              <h3>Commitment</h3>
              <PlanReliability rows={[{
                key: "person-commitment",
                label: "Commitments landed",
                percent: selected.commitmentRate,
                detail: selected.planned > 0 ? `${selected.plannedCompleted} of ${selected.planned} planned items` : "No planned items in this range",
              }]} />
            </section>
            {selected.sessionsNeedingCorrection > 0 ? (
              <Notice tone="warn">{selected.sessionsNeedingCorrection} session{selected.sessionsNeedingCorrection === 1 ? "" : "s"} still need a correction; unresolved time stays excluded from observed totals.</Notice>
            ) : null}
            <p className="admin-quiet">Last recorded activity {selected.lastActivityAt ? relativeTime(selected.lastActivityAt) : "—"}. Activity context never proves completion.</p>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
