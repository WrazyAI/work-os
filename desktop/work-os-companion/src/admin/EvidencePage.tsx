import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, Grid3X3, List } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import {
  adminKeys,
  ADMIN_STALE_MS,
  connectGithubRepo,
  disconnectGithubRepo,
  fetchAdminEvidence,
  fetchAdminIntervals,
  fetchConnections,
  fetchGithubActors,
  fetchGithubRepos,
  fetchPeople,
  normalizeConnections,
  normalizeEvidence,
  normalizeGithubActors,
  normalizeGithubRepos,
  normalizeIntervals,
  normalizePeople,
  relativeTime,
  statusLabel,
  isoDaysAgo,
  todayIso,
} from "./data";
import { AdminButton, Drawer, Notice, Pill, SelectField, Skeleton, TextField } from "./ui";
import EvidenceRecordView, { type EvidenceKindFilter, type EvidenceRecordFilters } from "./EvidenceRecordView";
import EvidenceCoverageView from "./EvidenceCoverageView";
import EvidenceDetailDrawer from "./EvidenceDetailDrawer";
import {
  buildCoverageRows,
  buildDateRange,
  coverageCell,
  evidenceKindOf,
  evidenceScreenshot,
  evidenceShortDate,
} from "./evidenceModel";
import { evidenceKindBucket } from "@wrazy/work-os-shared/evidence-kinds";
import type { ActivityIntervalView, EvidenceRow, EvidenceSummary } from "./types";
import "./evidence-hybrid.css";

type EvidenceTab = "evidence" | "recaps";
type EvidenceView = "record" | "coverage";

const SOURCE_OPTIONS = [
  { value: "worktivity", label: "Worktivity (activity)" },
  { value: "github", label: "GitHub" },
  { value: "ghl", label: "GoHighLevel" },
  { value: "loom", label: "Loom" },
  { value: "nifty", label: "Legacy import" },
];

const KIND_LABELS: Record<EvidenceKindFilter, string> = {
  all: "All kinds",
  calls: "Calls",
  emails: "Emails",
  texts: "Texts",
  work: "Work",
  context: "Context",
};

function sourceLabel(source: string) {
  return SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? "All sources";
}

function countsFromSummary(summary: EvidenceSummary | undefined, rows: EvidenceRow[]) {
  const counts = { all: 0, calls: 0, emails: 0, texts: 0, work: 0, context: 0 };
  if (summary?.kinds?.length) {
    for (const entry of summary.kinds) {
      counts.all += entry.count;
      counts[evidenceKindBucket(entry.kind)] += entry.count;
    }
    return counts;
  }
  for (const row of rows) {
    counts.all += 1;
    counts[evidenceKindBucket(evidenceKindOf(row))] += 1;
  }
  return counts;
}

/** Evidence keeps observation, output artifacts, and activity recaps visibly
 * apart. The record is the default reading; coverage is the same record seen
 * as a team-by-day matrix. */
export default function EvidencePage({ initialTab = "evidence", initialPersonId = "", initialSource = "", viewerPersonId = "" }: {
  initialTab?: EvidenceTab;
  initialPersonId?: string;
  initialSource?: string;
  viewerPersonId?: string;
} = {}) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [tab, setTab] = useState<EvidenceTab>(initialTab);
  const [view, setView] = useState<EvidenceView>("record");
  const [personId, setPersonId] = useState(initialPersonId);
  const [source, setSource] = useState(SOURCE_OPTIONS.some((option) => option.value === initialSource) ? initialSource : "");
  const [disputedOnly, setDisputedOnly] = useState(false);
  const [from, setFrom] = useState(() => isoDaysAgo(13));
  const [to, setTo] = useState(() => todayIso());
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [kind, setKind] = useState<EvidenceKindFilter>("all");
  const [selected, setSelected] = useState<EvidenceRow | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [reposOpen, setReposOpen] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [coverageSelection, setCoverageSelection] = useState<{ personId: string | null; date: string } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const people = useQuery({ queryKey: adminKeys.people(), queryFn: fetchPeople, select: normalizePeople, staleTime: ADMIN_STALE_MS });
  const evidenceFilters = {
    personId: personId === "unattributed" ? "" : personId,
    unattributed: personId === "unattributed" ? "1" : "",
    source,
    from,
    to,
    correction: disputedOnly ? "disputed" : "",
    q: debouncedSearch,
    kind,
    summary: "1",
    limit: "500",
  };
  const evidence = useQuery({
    queryKey: adminKeys.evidence(evidenceFilters),
    queryFn: () => fetchAdminEvidence(evidenceFilters),
    select: normalizeEvidence,
    staleTime: ADMIN_STALE_MS,
    enabled: view === "record" && tab === "evidence",
  });
  const intervalsFilters = { personId: personId === "unattributed" ? "" : personId, from, to, limit: "60" };
  const intervals = useQuery({
    queryKey: adminKeys.intervals(intervalsFilters),
    queryFn: () => fetchAdminIntervals(intervalsFilters),
    select: normalizeIntervals,
    staleTime: ADMIN_STALE_MS,
    enabled: tab === "recaps",
  });

  const pulseFrom = isoDaysAgo(13);
  const pulseTo = todayIso();
  const pulseFilters = { from: pulseFrom, to: pulseTo, limit: "1", summary: "1", pulse: "1" };
  const pulse = useQuery({
    queryKey: adminKeys.evidence(pulseFilters),
    queryFn: () => fetchAdminEvidence(pulseFilters),
    select: normalizeEvidence,
    staleTime: ADMIN_STALE_MS,
    enabled: view === "record" && tab === "evidence",
  });

  const coverageFrom = isoDaysAgo(13);
  const coverageTo = todayIso();
  const coverageFilters = { from: coverageFrom, to: coverageTo, limit: "1", summary: "1", coverage: "1" };
  const coverage = useQuery({
    queryKey: adminKeys.evidence(coverageFilters),
    queryFn: () => fetchAdminEvidence(coverageFilters),
    select: normalizeEvidence,
    staleTime: ADMIN_STALE_MS,
    enabled: view === "coverage",
  });

  const coverageDates = useMemo(() => buildDateRange(coverageFrom, coverageTo), [coverageFrom, coverageTo]);
  const coveragePeople = useMemo(
    () => (people.data?.people ?? []).map((person) => ({ id: String(person.id), display_name: String(person.display_name ?? "Unnamed") })),
    [people.data?.people],
  );
  const coverageRows = useMemo(
    () => buildCoverageRows(coverage.data?.summary, coveragePeople, coverageDates),
    [coverage.data?.summary, coveragePeople, coverageDates],
  );
  const effectiveCoverage = useMemo(() => {
    if (coverageSelection) return coverageSelection;
    if (!coverageRows.length || !coverageDates.length) return null;
    const totals = coverageDates.map((date) => ({ date, total: coverageRows.reduce((sum, row) => sum + coverageCell(row, date).count, 0) }));
    const busiest = totals.reduce((best, entry) => (entry.total > best.total ? entry : best), totals[0]);
    const row = coverageRows.find((entry) => coverageCell(entry, busiest.date).count > 0) ?? coverageRows[0];
    return row ? { personId: row.personId, date: busiest.date } : null;
  }, [coverageSelection, coverageRows, coverageDates]);
  const coverageDrillFilters = effectiveCoverage
    ? {
        ...(effectiveCoverage.personId ? { personId: effectiveCoverage.personId } : { unattributed: "1" }),
        date: effectiveCoverage.date,
        limit: "500",
        summary: "1",
      }
    : {};
  const coverageDrill = useQuery({
    queryKey: adminKeys.evidence(coverageDrillFilters),
    queryFn: () => fetchAdminEvidence(coverageDrillFilters),
    select: normalizeEvidence,
    staleTime: ADMIN_STALE_MS,
    enabled: view === "coverage" && !!effectiveCoverage,
  });

  const connections = useQuery({ queryKey: adminKeys.connections(), queryFn: fetchConnections, select: normalizeConnections, staleTime: ADMIN_STALE_MS });
  const githubActors = useQuery({ queryKey: adminKeys.githubActors(), queryFn: fetchGithubActors, select: normalizeGithubActors, staleTime: ADMIN_STALE_MS });
  const githubRepos = useQuery({ queryKey: adminKeys.githubRepos(), queryFn: fetchGithubRepos, select: normalizeGithubRepos, staleTime: ADMIN_STALE_MS, enabled: reposOpen });

  const connect = useMutation({
    mutationFn: (repo: string) => connectGithubRepo(repo),
    onSuccess: (result, repo) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.githubRepos() });
      const adopted = (result as { adopted?: unknown } | null)?.adopted === true;
      const message = adopted
        ? `An existing webhook for “${repo}” was aligned with this deployment.`
        : `A Work OS webhook was created for “${repo}”.`;
      setReceipt(message);
      notifications.success(message, adopted ? "Webhook adopted" : "Repository connected");
    },
    onError: () => setReceipt(null),
  });
  const disconnect = useMutation({
    mutationFn: (repo: string) => disconnectGithubRepo(repo),
    onSuccess: (_result, repo) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.githubRepos() });
      const message = `The Work OS webhook for “${repo}” was removed.`;
      setReceipt(message);
      notifications.success(message, "Repository removed");
    },
    onError: () => setReceipt(null),
  });

  const summary = evidence.data?.summary;
  const rawRows = evidence.data?.evidence ?? [];
  const counts = countsFromSummary(summary, rawRows);
  const visibleRows = rawRows.filter((row) => kind === "all" || evidenceKindBucket(evidenceKindOf(row)) === kind);
  const viewTotal = counts[kind];
  const peopleCount = kind === "all"
    ? summary?.peopleCount ?? new Set(rawRows.map((row) => row.person_id).filter(Boolean)).size
    : summary?.peopleByBucket?.[kind] ?? new Set(visibleRows.map((row) => row.person_id).filter(Boolean)).size;
  const personOptions = [
    { value: "", label: "All people" },
    ...(people.data?.people ?? []).map((person) => ({ value: String(person.id), label: String(person.display_name ?? "Unnamed") })),
    { value: "unattributed", label: "Unattributed" },
  ];
  const sourceOptions = [{ value: "", label: "All sources" }, ...SOURCE_OPTIONS];
  const personLabel = personId === "unattributed" ? "Unattributed" : personOptions.find((option) => option.value === personId)?.label ?? "All people";
  const rangeLabel = from === to ? evidenceShortDate(from) : `${evidenceShortDate(from)} – ${evidenceShortDate(to)}`;
  const scopeLabel = `${rangeLabel} · ${personLabel} · ${sourceLabel(source)} · ${KIND_LABELS[kind]}`;
  const thumbnailIds = useMemo(() => {
    const ids = new Set<string>();
    let remaining = 24;
    for (const row of rawRows) {
      if (remaining <= 0) break;
      if (row.source !== "worktivity") continue;
      const shot = evidenceScreenshot(row);
      if (!shot?.id || shot.deleted_at) continue;
      ids.add(shot.id);
      remaining -= 1;
    }
    return ids;
  }, [rawRows]);
  const githubConnection = (connections.data?.connections ?? []).find((row) => row.provider === "github" && row.active !== false) ?? null;
  const githubAccounts = (connections.data?.accounts ?? []).filter((row) => row.provider === "github");
  const actors = githubActors.data?.actors ?? [];
  const recapRows = (intervals.data?.intervals ?? []) as Array<ActivityIntervalView & { personId: string; personName: string | null }>;

  const patchFilters = (patch: Partial<EvidenceRecordFilters>) => {
    if (patch.personId !== undefined) setPersonId(patch.personId);
    if (patch.source !== undefined) setSource(patch.source);
    if (patch.from !== undefined) setFrom(patch.from);
    if (patch.to !== undefined) setTo(patch.to);
    if (patch.search !== undefined) setSearch(patch.search);
    if (patch.kind !== undefined) setKind(patch.kind);
    if (patch.disputed !== undefined) setDisputedOnly(patch.disputed);
    setSelected(null);
  };
  const clearFilters = () => {
    setPersonId("");
    setSource("");
    setKind("all");
    setSearch("");
    setDebouncedSearch("");
    setDisputedOnly(false);
    setFrom(isoDaysAgo(13));
    setTo(todayIso());
    setSelected(null);
  };
  const pickDay = (date: string) => {
    setFrom(date);
    setTo(date);
    setTab("evidence");
    setView("record");
    setSelected(null);
  };
  const openRecord = () => {
    if (!effectiveCoverage) return;
    setView("record");
    setTab("evidence");
    setPersonId(effectiveCoverage.personId ?? "unattributed");
    setSource("");
    setKind("all");
    setDisputedOnly(false);
    setSearch("");
    setDebouncedSearch("");
    setFrom(effectiveCoverage.date);
    setTo(effectiveCoverage.date);
    setSelected(null);
  };
  const openRepos = () => {
    setConnectionsOpen(false);
    setReposOpen(true);
  };

  return (
    <div className="evidence-hybrid">
      <div className="evidence-viewbar">
        <div className="evidence-view-toggle" role="group" aria-label="Evidence view">
          <button type="button" aria-pressed={view === "record"} className={view === "record" ? "is-active" : ""} onClick={() => { setView("record"); setSelected(null); }}>
            <List size={13} aria-hidden /> Record
          </button>
          <button type="button" aria-pressed={view === "coverage"} className={view === "coverage" ? "is-active" : ""} onClick={() => { setView("coverage"); setSelected(null); }}>
            <Grid3X3 size={13} aria-hidden /> Coverage
          </button>
        </div>
        <div className="evidence-viewbar-controls">
          {view === "record" ? (
            <>
              <TextField label="From" type="date" value={from} onChange={setFrom} ariaLabel="Evidence from date" />
              <TextField label="To" type="date" value={to} onChange={setTo} ariaLabel="Evidence to date" />
              {tab === "evidence" ? (
                <button type="button" className="admin-button ghost" onClick={() => { setTab("recaps"); setSelected(null); }}>Activity recaps</button>
              ) : (
                <button type="button" className="admin-button ghost" onClick={() => { setTab("evidence"); setSelected(null); }}>Back to evidence</button>
              )}
            </>
          ) : <span className="evidence-viewbar-note">Last 14 days</span>}
          <button type="button" className="admin-button ghost evidence-connections-button" onClick={() => setConnectionsOpen(true)}>
            <GitBranch size={13} aria-hidden /> Connections
            {actors.length ? <span className="evidence-alert">{actors.length}</span> : null}
          </button>
        </div>
      </div>

      {view === "coverage" ? (
        <EvidenceCoverageView
          summary={coverage.data?.summary}
          people={coveragePeople}
          dates={coverageDates}
          selection={effectiveCoverage}
          drillRows={coverageDrill.data?.evidence ?? []}
          loading={coverage.isLoading}
          error={coverage.error as Error | null}
          drillLoading={coverageDrill.isLoading}
          drillError={coverageDrill.error as Error | null}
          thumbnailIds={thumbnailIds}
          onSelect={(nextPersonId, date) => setCoverageSelection({ personId: nextPersonId, date })}
          onOpenRecord={openRecord}
          onSelectRow={setSelected}
        />
      ) : tab === "recaps" ? (
        <section className="evidence-record" aria-label="Activity recaps">
          <div className="evidence-coverage-head">
            <div>
              <h2>Activity recaps</h2>
              <p>Reviewed activity intervals in the selected range. Evidence and recaps stay separate records.</p>
            </div>
            <SelectField label="Person" value={personId === "unattributed" ? "" : personId} onChange={(value) => setPersonId(value)} options={personOptions.filter((option) => option.value !== "unattributed")} />
          </div>
          {intervals.isLoading ? (
            <div className="evidence-loading"><Skeleton className="h-32" /></div>
          ) : intervals.error ? (
            <div className="evidence-loading"><Notice tone="err">{(intervals.error as Error).message}</Notice></div>
          ) : recapRows.length ? (
            <ul className="admin-recap-list">
              {recapRows.map((interval) => (
                <li key={interval.id}>
                  <div className="admin-recap-head">
                    <span className="min-w-0"><b>{interval.personName ?? "Unmapped person"}</b><small>{interval.label} · {statusLabel(interval.reviewStatus)}</small></span>
                    <Pill tone={interval.reviewStatus === "confirmed" ? "ok" : interval.reviewStatus === "amended" ? "info" : "neutral"}>{interval.evidenceCount} evidence item{interval.evidenceCount === 1 ? "" : "s"}</Pill>
                  </div>
                  <p>{interval.headline ?? "No headline was recorded for this interval."}</p>
                  {interval.detail ? <p className="admin-quiet">{interval.detail}</p> : null}
                  {interval.recordedActivity?.length ? (
                    <ul className="admin-rows">
                      {interval.recordedActivity.slice(0, 6).map((entry, index) => (
                        <li key={index}><span>{entry.description}</span><Pill tone={entry.relation === "performed" ? "ok" : "observed"}>{entry.relation === "performed" ? "Performed" : "Triggered by their work"}</Pill></li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="evidence-empty"><h3>No activity recaps were recorded in this range</h3><p>Widen the date range or choose another person.</p></div>
          )}
        </section>
      ) : (
        <EvidenceRecordView
          rows={visibleRows}
          viewTotal={viewTotal}
          loadedCount={visibleRows.length}
          partial={viewTotal > visibleRows.length}
          counts={counts}
          peopleCount={peopleCount}
          capped={summary?.capped === true}
          pulseDays={pulse.data?.summary?.days ?? []}
          pulseFrom={pulseFrom}
          pulseTo={pulseTo}
          pulseLoading={pulse.isLoading}
          pulseError={pulse.error as Error | null}
          filters={{ personId, source, from, to, search, kind, disputed: disputedOnly }}
          personOptions={personOptions}
          sourceOptions={sourceOptions}
          scopeLabel={scopeLabel}
          loading={evidence.isLoading}
          error={evidence.error as Error | null}
          thumbnailIds={thumbnailIds}
          onFilters={patchFilters}
          onPickDay={pickDay}
          onSelect={setSelected}
          onClearFilters={clearFilters}
        />
      )}

      <EvidenceDetailDrawer row={selected} viewerPersonId={viewerPersonId} onClose={() => setSelected(null)} />

      <Drawer open={connectionsOpen} onClose={() => setConnectionsOpen(false)} title="Connections" subtitle="Provider evidence that feeds the record" width={560}>
        <div className="admin-grid">
          {connections.isLoading ? <Skeleton className="h-32" /> : connections.error ? <Notice tone="err">{(connections.error as Error).message}</Notice> : (
            <section className="admin-block">
              <h3>GitHub</h3>
              <div className="admin-kv-grid">
                <div className="admin-kv"><span>Status</span><b>{githubConnection ? "Connected" : "Not connected"}</b></div>
                <div className="admin-kv"><span>Workspace</span><b className="is-mono">{githubConnection ? String(githubConnection.external_workspace_id ?? "—") : "—"}</b></div>
                <div className="admin-kv"><span>Mapped accounts</span><b>{githubAccounts.length}</b></div>
                <div className="admin-kv"><span>Last event</span><b>{githubActors.data?.totals?.lastEventAt ? relativeTime(githubActors.data.totals.lastEventAt) : "none yet"}</b></div>
              </div>
              {githubConnection ? <AdminButton variant="secondary" onClick={openRepos}>Manage repositories</AdminButton> : null}
              {receipt ? <Notice tone="ok">{receipt}</Notice> : null}
              <p className="admin-quiet">Provider tokens and webhook secrets never reach this window.</p>
            </section>
          )}
          {actors.length ? (
            <section className="admin-block">
              <h3>Unmapped GitHub accounts</h3>
              <p className="admin-quiet">{githubActors.data?.totals?.unattributedEvents ?? 0} event{(githubActors.data?.totals?.unattributedEvents ?? 0) === 1 ? "" : "s"} waiting for a person. Mapping also attributes earlier events.</p>
              <ul className="admin-rows spaced">
                {actors.slice(0, 12).map((actor) => (
                  <li key={actor.key} className="admin-actor">
                    <span className="min-w-0"><b>{actor.login ?? (actor.id ? `GitHub id ${actor.id}` : "Unmapped GitHub account")}</b><small>{actor.events} event{actor.events === 1 ? "" : "s"} · last {relativeTime(actor.lastSeen)}{actor.titles[0] ? ` · ${actor.titles[0]}` : ""}</small></span>
                    <Pill tone="warn">Map &amp; backfill in the web console</Pill>
                  </li>
                ))}
              </ul>
              <p className="admin-quiet">Account mapping writes provider identities; keep that write in the web console where the full workspace context is on screen.</p>
            </section>
          ) : null}
        </div>
      </Drawer>

      <Drawer open={reposOpen} onClose={() => setReposOpen(false)} title="GitHub repositories" subtitle={githubRepos.data?.organization ? `Organization ${githubRepos.data.organization}` : "Repository webhooks"} width={620}>
        {githubRepos.isLoading ? <Skeleton className="h-40" /> : githubRepos.error ? <Notice tone="err">{(githubRepos.error as Error).message}</Notice> : (
          <div className="admin-grid">
            {connect.error || disconnect.error ? <Notice tone="err">{((connect.error || disconnect.error) as Error).message}</Notice> : null}
            {githubRepos.data?.configuration?.repositoryManagementReady ? (
              <ul className="admin-rows spaced">
                {(githubRepos.data?.repos ?? []).map((repo) => {
                  const connected = (githubRepos.data?.connectedRepos ?? []).some((entry) => entry.full_name === repo.full_name);
                  return (
                    <li key={repo.full_name} className="admin-actor">
                      <span className="min-w-0"><b>{repo.full_name}</b><small>{repo.private ? "Private" : "Public"} · default {repo.default_branch} · pushed {repo.pushed_at ? relativeTime(repo.pushed_at) : "—"}</small></span>
                      {connected ? <AdminButton variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate(repo.full_name)}>Remove</AdminButton> : <AdminButton variant="secondary" disabled={connect.isPending} onClick={() => connect.mutate(repo.full_name)}>Connect</AdminButton>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <>
                <Notice tone="warn">{githubRepos.data?.configuration?.reason ?? "Repository management is not configured; add repo webhooks manually."}</Notice>
                <p className="admin-quiet">Webhook endpoint: <code>{githubRepos.data?.webhookUrl}</code></p>
                <p className="admin-quiet">{githubRepos.data?.connectedRepos?.length ?? 0} repositories are already connected.</p>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
