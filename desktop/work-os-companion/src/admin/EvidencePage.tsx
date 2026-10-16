import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Camera, Check, GitBranch, RefreshCw, ShieldCheck } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import { formatWorkOsFullDate } from "../dateFormat";
import {
  adminKeys,
  ADMIN_STALE_MS,
  connectGithubRepo,
  disconnectGithubRepo,
  evidenceSourceLabel,
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
  requestScreenshotAccess,
  statusLabel,
  isoDaysAgo,
  todayIso,
} from "./data";
import { ShareBars } from "./charts";
import { one, type ActivityIntervalView, type EvidenceRow } from "./types";
import { AdminButton, AdminCard, AdminControls, AdminControlsGroup, Avatar, CheckField, Drawer, Notice, Pill, Segmented, SelectField, Skeleton, TextField } from "./ui";

type EvidenceTab = "evidence" | "recaps";

const SOURCE_OPTIONS = [
  { value: "worktivity", label: "Worktivity (activity)" },
  { value: "github", label: "GitHub" },
  { value: "loom", label: "Loom" },
  { value: "nifty", label: "Nifty" },
];

function screenshotOf(row: EvidenceRow) {
  return one<{ id: string; processing_status: string; summary: string | null; confidence: number | null; storage_path: string | null; deleted_at: string | null }>(row.event?.screenshot);
}

/** Evidence keeps observation, output artifacts, and activity recaps visibly
 * apart; the raw-frame preview stays inside the flagged/disputed rule and
 * records a reason with every view. A caller can land directly on the
 * activity-recap tab (the Overview recap action does). */
export default function EvidencePage({ initialTab = "evidence" }: { initialTab?: EvidenceTab } = {}) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [tab, setTab] = useState<EvidenceTab>(initialTab);
  const [personId, setPersonId] = useState("");
  const [source, setSource] = useState("");
  const [disputedOnly, setDisputedOnly] = useState(false);
  const [from, setFrom] = useState(() => isoDaysAgo(13));
  const [to, setTo] = useState(() => todayIso());
  const [selected, setSelected] = useState<EvidenceRow | null>(null);
  const [reposOpen, setReposOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const people = useQuery({ queryKey: adminKeys.people(), queryFn: fetchPeople, select: normalizePeople, staleTime: ADMIN_STALE_MS });
  const filters = { personId, source: tab === "evidence" ? source : "", from, to, correction: disputedOnly ? "disputed" : "", summary: "1", limit: "100" };
  const evidence = useQuery({
    queryKey: adminKeys.evidence(filters),
    queryFn: () => fetchAdminEvidence(filters),
    select: normalizeEvidence,
    staleTime: ADMIN_STALE_MS,
  });
  const intervalsFilters = { personId, from, to, limit: "60" };
  const intervals = useQuery({
    queryKey: adminKeys.intervals(intervalsFilters),
    queryFn: () => fetchAdminIntervals(intervalsFilters),
    select: normalizeIntervals,
    staleTime: ADMIN_STALE_MS,
    enabled: tab === "recaps",
  });
  const connections = useQuery({ queryKey: adminKeys.connections(), queryFn: fetchConnections, select: normalizeConnections, staleTime: ADMIN_STALE_MS });
  const githubActors = useQuery({ queryKey: adminKeys.githubActors(), queryFn: fetchGithubActors, select: normalizeGithubActors, staleTime: ADMIN_STALE_MS });
  const githubRepos = useQuery({ queryKey: adminKeys.githubRepos(), queryFn: fetchGithubRepos, select: normalizeGithubRepos, staleTime: ADMIN_STALE_MS, enabled: reposOpen });

  const access = useMutation({
    mutationFn: ({ summaryId, reason: why }: { summaryId: string; reason: string }) => requestScreenshotAccess(summaryId, why),
    onSuccess: (result) => {
      setScreenshotError(null);
      setScreenshotUrl(result.url);
      // The route records the reason before it answers, so the receipt may say
      // the view was logged; the frame itself is what the drawer then shows.
      notifications.success("The retained frame is ready; this view was recorded with your reason.", "Screenshot access prepared");
    },
    onError: (error) => setScreenshotError((error as Error).message),
  });
  const connect = useMutation({
    mutationFn: (repo: string) => connectGithubRepo(repo),
    onSuccess: (result, repo) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.githubRepos() });
      // The route answers with what it actually did: it created a hook, or it
      // adopted one that already pointed at this receiver.
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

  const grouped = useMemo(() => {
    const map = new Map<string, EvidenceRow[]>();
    for (const row of evidence.data?.evidence ?? []) {
      const list = map.get(row.evidence_date) ?? [];
      list.push(row);
      map.set(row.evidence_date, list);
    }
    return [...map.entries()].sort((left, right) => right[0].localeCompare(left[0]));
  }, [evidence.data]);

  const personOptions = (people.data?.people ?? []).map((person) => ({ value: String(person.id), label: String(person.display_name ?? "Unnamed") }));
  const githubConnection = (connections.data?.connections ?? []).find((row) => row.provider === "github" && row.active !== false) ?? null;
  const githubAccounts = (connections.data?.accounts ?? []).filter((row) => row.provider === "github");
  const actors = githubActors.data?.actors ?? [];
  const sources = evidence.data?.summary?.sources ?? [];
  const selectedShot = selected ? screenshotOf(selected) : null;
  const selectedReviewable = !!selected && (selected.event?.correction_status === "disputed" || one<Record<string, unknown>>(selected.event?.metadata)?.needsReview === true);

  return (
    <div className="admin-grid">
      <AdminCard
        icon={Camera}
        title="Record shape"
        detail={`Evidence by source between ${formatWorkOsFullDate(from)} and ${formatWorkOsFullDate(to)}`}
      >
        <ShareBars ariaLabel="Evidence items in this range by source" items={sources.map((entry) => ({ label: evidenceSourceLabel(entry.source), value: entry.count }))} />
      </AdminCard>

      <AdminCard
        icon={GitBranch}
        title="Integrations"
        detail="Provider evidence that feeds the record"
        action={githubConnection ? <AdminButton variant="secondary" onClick={() => setReposOpen(true)}>Manage repositories</AdminButton> : null}
      >
        <div className="admin-integration-row">
          <div className="admin-kv-grid">
            <div className="admin-kv"><span>GitHub</span><b>{githubConnection ? "Connected" : "Not connected"}</b></div>
            <div className="admin-kv"><span>Workspace</span><b className="is-mono">{githubConnection ? String(githubConnection.external_workspace_id ?? "—") : "—"}</b></div>
            <div className="admin-kv"><span>Mapped accounts</span><b>{githubAccounts.length}</b></div>
            <div className="admin-kv"><span>Last event</span><b>{githubActors.data?.totals?.lastEventAt ? relativeTime(githubActors.data.totals.lastEventAt) : "none yet"}</b></div>
          </div>
          {receipt ? <Notice tone="ok">{receipt}</Notice> : null}
        </div>
      </AdminCard>

      {actors.length ? (
        <AdminCard
          icon={GitBranch}
          title="Unmapped GitHub accounts"
          detail={`${githubActors.data?.totals?.unattributedEvents ?? 0} event${(githubActors.data?.totals?.unattributedEvents ?? 0) === 1 ? "" : "s"} waiting for a person · mapping also attributes earlier events`}
        >
          <ul className="admin-rows spaced">
            {actors.slice(0, 8).map((actor) => (
              <li key={actor.key} className="admin-actor">
                <span className="min-w-0">
                  <b>{actor.login ?? (actor.id ? `GitHub id ${actor.id}` : "Unmapped GitHub account")}</b>
                  <small>{actor.events} event{actor.events === 1 ? "" : "s"} · last {relativeTime(actor.lastSeen)}{actor.titles[0] ? ` · ${actor.titles[0]}` : ""}</small>
                </span>
                <Pill tone="warn">Map &amp; backfill in the web console</Pill>
              </li>
            ))}
          </ul>
          <p className="admin-quiet">Account mapping writes provider identities; keep that write in the web console where the full workspace context is on screen.</p>
        </AdminCard>
      ) : null}

      <AdminCard
        icon={Activity}
        title="The record"
        detail="Evidence rows and activity recaps stay separate"
        padded={false}
        controls={
          <>
            {/* The view, the person, and the source share the first controls
                row; the range travels as one pair with its disputed filter on
                the row below it. */}
            <AdminControls>
              <AdminControlsGroup>
                <Segmented<EvidenceTab>
                  ariaLabel="Evidence view"
                  value={tab}
                  onChange={(next) => { setTab(next); setSelected(null); setScreenshotUrl(null); }}
                  options={[{ value: "evidence", label: "Evidence" }, { value: "recaps", label: "Activity recaps" }]}
                />
              </AdminControlsGroup>
              <AdminControlsGroup>
                <SelectField ariaLabel="Filter by person" value={personId} onChange={setPersonId} placeholder="All people" options={personOptions} />
              </AdminControlsGroup>
              {tab === "evidence" ? (
                <AdminControlsGroup>
                  <SelectField ariaLabel="Filter by source" value={source} onChange={setSource} placeholder="All sources" options={SOURCE_OPTIONS} />
                </AdminControlsGroup>
              ) : null}
            </AdminControls>
            <AdminControls>
              <AdminControlsGroup>
                <TextField label="From" type="date" value={from} onChange={setFrom} ariaLabel="Evidence from date" />
                <TextField label="To" type="date" value={to} onChange={setTo} ariaLabel="Evidence to date" />
                {tab === "evidence" ? <CheckField label="Disputed only" checked={disputedOnly} onChange={setDisputedOnly} /> : null}
              </AdminControlsGroup>
            </AdminControls>
          </>
        }
      >
        {tab === "evidence" ? (
          evidence.isLoading ? (
            <div className="admin-card-body is-padded"><div className="admin-grid"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div></div>
          ) : evidence.error ? (
            <div className="admin-card-body is-padded"><Notice tone="err">{(evidence.error as Error).message}</Notice></div>
          ) : grouped.length ? (
            <div className="admin-groups">
              {grouped.map(([date, rows]) => (
                <section key={date}>
                  <h3>{formatWorkOsFullDate(date)}<small>{rows.length} item{rows.length === 1 ? "" : "s"}</small></h3>
                  <ul>
                    {rows.map((row) => (
                      <li key={row.id}>
                        <button type="button" onClick={() => { setSelected(row); setReason(""); setScreenshotUrl(null); setScreenshotError(null); }}>
                          <span className="min-w-0">
                            <b>{row.title}</b>
                            <small>{row.person?.display_name ?? "Unmapped person"} · {row.summary}</small>
                          </span>
                          <span className="admin-activity-meta">
                            {row.event?.correction_status === "disputed" ? <Pill tone="err">Disputed</Pill> : null}
                            <Pill tone={row.source === "worktivity" ? "observed" : "neutral"}>{evidenceSourceLabel(row.source)}</Pill>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="admin-card-body is-padded"><p className="admin-empty-note">No evidence matches these filters.</p></div>
          )
        ) : intervals.isLoading ? (
          <div className="admin-card-body is-padded"><Skeleton className="h-32" /></div>
        ) : intervals.error ? (
          <div className="admin-card-body is-padded"><Notice tone="err">{(intervals.error as Error).message}</Notice></div>
        ) : (intervals.data?.intervals ?? []).length ? (
          <ul className="admin-recap-list">
            {(intervals.data?.intervals ?? []).map((interval: ActivityIntervalView & { personId: string; personName: string | null }) => (
              <li key={interval.id}>
                <div className="admin-recap-head">
                  <span className="min-w-0">
                    <b>{interval.personName ?? "Unmapped person"}</b>
                    <small>{interval.label} · {statusLabel(interval.reviewStatus)}</small>
                  </span>
                  <Pill tone={interval.reviewStatus === "confirmed" ? "ok" : interval.reviewStatus === "amended" ? "info" : "neutral"}>
                    {interval.evidenceCount} evidence item{interval.evidenceCount === 1 ? "" : "s"}
                  </Pill>
                </div>
                <p>{interval.headline ?? "No headline was recorded for this interval."}</p>
                {interval.detail ? <p className="admin-quiet">{interval.detail}</p> : null}
                {interval.recordedActivity?.length ? (
                  <ul className="admin-rows">
                    {interval.recordedActivity.slice(0, 6).map((entry, index) => (
                      <li key={index}>
                        <span>{entry.description}</span>
                        <Pill tone={entry.relation === "performed" ? "ok" : "observed"}>{entry.relation === "performed" ? "Performed" : "Triggered by their work"}</Pill>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="admin-card-body is-padded"><p className="admin-empty-note">No activity recaps were recorded in this range.</p></div>
        )}
      </AdminCard>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title ?? "Evidence"}
        subtitle={selected ? `${selected.person?.display_name ?? "Unmapped person"} · ${formatWorkOsFullDate(selected.evidence_date)}` : undefined}
        width={560}
      >
        {selected ? (
          <div className="admin-grid admin-drawer-grid">
            <section className="admin-block">
              <h3>Provenance</h3>
              <div className="admin-kv-grid">
                <div className="admin-kv"><span>Source</span><b>{evidenceSourceLabel(selected.source)}</b></div>
                <div className="admin-kv"><span>Class</span><b>{statusLabel(selected.event?.evidence_class ?? "—")}</b></div>
                <div className="admin-kv"><span>Correction state</span><b>{statusLabel(selected.event?.correction_status ?? "none")}</b></div>
                <div className="admin-kv"><span>Recorded</span><b>{relativeTime(selected.created_at)}</b></div>
                {selected.task ? <div className="admin-kv"><span>Task</span><b>{selected.task.title}</b></div> : null}
              </div>
              <p className="admin-quiet">{selected.summary}</p>
              {selected.url ? <p><a href={selected.url} target="_blank" rel="noreferrer">Open the artifact</a></p> : null}
            </section>
            {selectedShot ? (
              <section className="admin-block">
                <h3><ShieldCheck size={14} aria-hidden /> Screenshot frame</h3>
                <div className="admin-kv-grid">
                  <div className="admin-kv"><span>Processing</span><b>{statusLabel(selectedShot.processing_status)}</b></div>
                  <div className="admin-kv"><span>Confidence</span><b>{selectedShot.confidence != null ? `${Math.round(selectedShot.confidence * 100)}%` : "—"}</b></div>
                </div>
                {selectedShot.summary ? <p className="admin-quiet">{selectedShot.summary}</p> : null}
                {selectedShot.deleted_at ? (
                  <Notice tone="warn">This frame was flagged as sensitive and the image was deleted; the summary stays on the record.</Notice>
                ) : selectedReviewable ? (
                  <>
                    <p className="admin-quiet">Raw frames stay limited to flagged or disputed review. Every view is recorded with the reason you give.</p>
                    <div className="admin-inline-fields">
                      <TextField label="Reason" value={reason} onChange={setReason} ariaLabel="Reason for viewing this retained screenshot" placeholder="Why this frame is being reviewed" />
                      <AdminButton
                        variant="secondary"
                        icon={Camera}
                        disabled={!reason.trim() || access.isPending}
                        onClick={() => access.mutate({ summaryId: selectedShot.id, reason: reason.trim() })}
                      >
                        {access.isPending ? "Preparing…" : "View frame"}
                      </AdminButton>
                    </div>
                    {screenshotError ? <Notice tone="err">{screenshotError}</Notice> : null}
                    {screenshotUrl ? <img className="admin-shot" src={screenshotUrl} alt="Retained screenshot frame for this evidence item" /> : null}
                  </>
                ) : (
                  <Notice tone="info">Raw frames stay behind the flagged/disputed review rule. This item is not disputed, so only its summary is shown.</Notice>
                )}
              </section>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={reposOpen}
        onClose={() => setReposOpen(false)}
        title="GitHub repositories"
        subtitle={githubRepos.data?.organization ? `Organization ${githubRepos.data.organization}` : "Repository webhooks"}
        width={620}
      >
        {githubRepos.isLoading ? (
          <Skeleton className="h-40" />
        ) : githubRepos.error ? (
          <Notice tone="err">{(githubRepos.error as Error).message}</Notice>
        ) : (
          <div className="admin-grid">
            {connect.error || disconnect.error ? (
              <Notice tone="err">{((connect.error || disconnect.error) as Error).message}</Notice>
            ) : null}
            {githubRepos.data?.configuration?.repositoryManagementReady ? (
              <ul className="admin-rows spaced">
                {(githubRepos.data?.repos ?? []).map((repo) => {
                  const connected = (githubRepos.data?.connectedRepos ?? []).some((entry) => entry.full_name === repo.full_name);
                  return (
                    <li key={repo.full_name} className="admin-actor">
                      <span className="min-w-0"><b>{repo.full_name}</b><small>{repo.private ? "Private" : "Public"} · default {repo.default_branch} · pushed {repo.pushed_at ? relativeTime(repo.pushed_at) : "—"}</small></span>
                      {connected ? (
                        <AdminButton variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate(repo.full_name)}>Remove</AdminButton>
                      ) : (
                        <AdminButton variant="secondary" icon={Check} disabled={connect.isPending} onClick={() => connect.mutate(repo.full_name)}>Connect</AdminButton>
                      )}
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
