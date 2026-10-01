"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Cable, Camera, Check, Eye, GitBranch, Link2, ShieldCheck } from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { embeddedRow } from "@/lib/work-os-embed-shape";
import {
  adminFetch,
  adminKeys,
  type ActivityIntervalView,
  type EvidenceRow,
  type GithubIntegrationActorsResponse,
  type GithubIntegrationReposResponse,
} from "./api";
import {
  AdminCard,
  Button,
  Drawer,
  EmptyState,
  Notice,
  ProvenanceChip,
  SectionHeading,
  SegmentedControl,
  SelectField,
  Skeleton,
  StatusPill,
  TextField,
  relativeTime,
  statusLabel,
} from "./ui";

type EvidenceTab = "evidence" | "recaps";
type AnyRow = Record<string, any>;

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const SOURCE_OPTIONS = [
  { value: "worktivity", label: "Worktivity (activity)" },
  { value: "github", label: "GitHub" },
  { value: "ghl", label: "GHL — coming soon", disabled: true },
  { value: "loom", label: "Loom" },
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Agent" },
  { value: "nifty", label: "Nifty" },
  { value: "crm", label: "CRM" },
  { value: "media", label: "Media" },
];

export default function AdminEvidencePage() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState<EvidenceTab>("evidence");
  const [from, setFrom] = useState(() => isoDaysAgo(7));
  const [to, setTo] = useState(today);
  const [personId, setPersonId] = useState("");
  const [source, setSource] = useState("");
  const [disputedOnly, setDisputedOnly] = useState(false);
  const [selected, setSelected] = useState<EvidenceRow | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [reposOpen, setReposOpen] = useState(false);
  const [actorPerson, setActorPerson] = useState<Record<string, string>>({});
  const [mappingReceipt, setMappingReceipt] = useState<string | null>(null);

  const people = useQuery<{ people: Array<{ id: string; display_name: string }> }>({
    queryKey: adminKeys.people(),
    queryFn: () => adminFetch("/api/work-os/people"),
    staleTime: 60_000,
  });
  const connections = useQuery<{ connections: AnyRow[]; accounts: AnyRow[] }>({
    queryKey: adminKeys.connections(),
    queryFn: () => adminFetch("/api/work-os/integrations/connections"),
    staleTime: 30_000,
  });
  const githubActors = useQuery<GithubIntegrationActorsResponse>({
    queryKey: adminKeys.githubActors(),
    queryFn: () => adminFetch<GithubIntegrationActorsResponse>("/api/work-os/admin/integrations/github/actors"),
    staleTime: 30_000,
  });

  const filters = { from, to, personId, source, disputed: disputedOnly ? "1" : "" };
  const evidence = useQuery<{ evidence: EvidenceRow[] }>({
    queryKey: adminKeys.evidence(filters),
    queryFn: () => {
      const params = new URLSearchParams({ from, to, limit: "300" });
      if (personId) params.set("personId", personId);
      if (source) params.set("source", source);
      if (disputedOnly) params.set("correction", "disputed");
      return adminFetch(`/api/work-os/evidence?${params.toString()}`);
    },
    staleTime: 60_000,
  });
  const intervals = useQuery<{ intervals: Array<ActivityIntervalView & { personId: string; personName: string | null }> }>({
    queryKey: adminKeys.intervals(from, to, personId),
    queryFn: () => {
      const params = new URLSearchParams({ from, to, limit: "120" });
      if (personId) params.set("personId", personId);
      return adminFetch(`/api/work-os/admin/activity-intervals?${params.toString()}`);
    },
    enabled: tab === "recaps",
    staleTime: 60_000,
  });

  const screenshotAccess = useMutation({
    mutationFn: (summaryId: string) => {
      const reason = window.prompt("Reason for restricted screenshot access (recorded in the audit log)");
      if (!reason?.trim()) throw new Error("A reason is required to open a retained screenshot.");
      return adminFetch<{ url: string }>(`/api/work-os/evidence/screenshots/${summaryId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
    },
    onSuccess: (result) => {
      setScreenshotError(null);
      setScreenshotUrl(result.url);
    },
    onError: (error) => setScreenshotError((error as Error).message),
  });

  const mapActor = useMutation({
    mutationFn: ({ actor, personId: targetPersonId }: { actor: GithubIntegrationActorsResponse["actors"][number]; personId: string }) => {
      const workspace = (connections.data?.connections ?? []).find((row) => row.provider === "github" && row.active !== false)?.external_workspace_id;
      if (!workspace) throw new Error("Connect the GitHub workspace in Settings before mapping accounts.");
      const accountId = actor.id ?? actor.login;
      if (!accountId) throw new Error("This account has no usable GitHub identifier.");
      return adminFetch<{ attributed?: number }>("/api/work-os/integrations/connections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "github",
          external_workspace_id: String(workspace),
          accounts: [{
            external_account_id: accountId,
            person_id: targetPersonId,
            verified: true,
            metadata: { login: actor.login },
          }],
        }),
      });
    },
    onSuccess: (result, variables) => {
      setMappingReceipt(`${variables.actor.login ?? variables.actor.id} is mapped and verified.${result.attributed ? ` ${result.attributed} earlier event${result.attributed === 1 ? "" : "s"} attributed.` : ""}`);
      void queryClient.invalidateQueries({ queryKey: ["work-os"] });
    },
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

  const personOptions = (people.data?.people ?? []).map((person) => ({ value: person.id, label: person.display_name }));
  const githubConnection = (connections.data?.connections ?? []).find((row) => row.provider === "github" && row.active !== false) ?? null;
  const githubAccounts = (connections.data?.accounts ?? []).filter((row) => row.provider === "github");
  const actors = githubActors.data?.actors ?? [];

  return (
    <div className="grid gap-5">
      {/* Integrations band */}
      <AdminCard>
        <SectionHeading
          icon={Cable}
          title="Integrations"
          detail="Provider evidence that feeds this record. Observation is never completion."
          action={<Link href="/work-os/admin/settings" className="text-[11.5px] font-semibold" style={{ color: "var(--accent)" }}>Open Settings</Link>}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <GitBranch size={15} style={{ color: "var(--accent)" }} aria-hidden /> GitHub
              </span>
              <StatusPill tone={githubConnection ? "ok" : "warn"}>{githubConnection ? "Connected" : "Not connected"}</StatusPill>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-5 text-[var(--text-tertiary)]">
              {githubConnection
                ? <>Workspace {String(githubConnection.external_workspace_id)} · {githubAccounts.length} mapped account{githubAccounts.length === 1 ? "" : "s"} · last event {githubActors.data?.totals.lastEventAt ? relativeTime(githubActors.data.totals.lastEventAt) : "none yet"}.</>
                : "Connect the WrazyAI workspace webhook so commits, pull requests, reviews, and workflow runs become output evidence."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={!githubConnection} onClick={() => setReposOpen(true)}>
                Manage repositories
              </Button>
              {githubConnection ? (
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  {githubActors.data?.configuration.repositoryManagementReady ? "Add or remove repo webhooks here." : "Repository management token not configured — see the drawer for manual steps."}
                </span>
              ) : null}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border p-4" style={{ borderColor: "var(--border-subtle)" }} aria-disabled="true">
            <div className="pointer-events-none select-none blur-[3px]" aria-hidden="true">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                  <Cable size={15} style={{ color: "var(--accent)" }} /> GHL
                </span>
                <StatusPill tone="ok">Connected</StatusPill>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-5 text-[var(--text-tertiary)]">
                Opportunity, appointment, and conversation activity from GoHighLevel becomes output evidence for the mapped person.
              </p>
              <div className="mt-3 flex gap-2">
                <ProvenanceChip>Opportunities</ProvenanceChip>
                <ProvenanceChip>Appointments</ProvenanceChip>
                <ProvenanceChip>Conversations</ProvenanceChip>
              </div>
            </div>
            <div className="absolute inset-0 flex items-end justify-end p-4">
              <StatusPill tone="neutral">Coming soon</StatusPill>
            </div>
          </div>
        </div>
      </AdminCard>

      {/* Unmapped GitHub accounts */}
      {actors.length ? (
        <AdminCard>
          <SectionHeading
            icon={GitBranch}
            title="Unmapped GitHub accounts"
            detail={`${githubActors.data?.totals.unattributedEvents ?? 0} event${(githubActors.data?.totals.unattributedEvents ?? 0) === 1 ? "" : "s"} from ${actors.length} account${actors.length === 1 ? "" : "s"} waiting for a person. Mapping an account also attributes its earlier events.`}
          />
          <ul className="grid gap-2">
            {actors.map((actor) => {
              const value = actorPerson[actor.key] ?? actor.suggestion?.personId ?? "";
              return (
                <li key={actor.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{actor.login ?? `GitHub id ${actor.id}`}</span>
                    <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                      {actor.events} event{actor.events === 1 ? "" : "s"} · last {relativeTime(actor.lastSeen)}{actor.titles[0] ? ` · ${actor.titles[0]}` : ""}
                    </span>
                  </span>
                  <SelectField
                    label="Person"
                    value={value}
                    onChange={(next) => setActorPerson((current) => ({ ...current, [actor.key]: next }))}
                    options={personOptions}
                    placeholder="Select a person"
                    ariaLabel={`Map ${actor.login ?? actor.id} to a person`}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!value || mapActor.isPending}
                    onClick={() => mapActor.mutate({ actor, personId: value })}
                  >
                    <Check size={12} aria-hidden /> Map &amp; backfill
                  </Button>
                </li>
              );
            })}
          </ul>
          {mappingReceipt ? <div className="mt-3"><Notice tone="ok">{mappingReceipt}</Notice></div> : null}
          {mapActor.error ? <div className="mt-3"><Notice tone="err">{(mapActor.error as Error).message}</Notice></div> : null}
        </AdminCard>
      ) : null}

      <AdminCard padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <SegmentedControl<EvidenceTab>
            ariaLabel="Evidence view"
            value={tab}
            onChange={setTab}
            options={[
              { value: "evidence", label: "Evidence" },
              { value: "recaps", label: "Activity recaps" },
            ]}
          />
          <div className="flex flex-wrap items-end gap-2">
            <SelectField label="Person" value={personId} onChange={setPersonId} options={personOptions} placeholder="All people" ariaLabel="Filter by person" />
            {tab === "evidence" ? (
              <SelectField label="Source" value={source} onChange={setSource} options={SOURCE_OPTIONS} placeholder="All sources" ariaLabel="Filter by source" />
            ) : null}
            <TextField label="From" type="date" value={from} onChange={setFrom} ariaLabel="Evidence from date" />
            <TextField label="To" type="date" value={to} onChange={setTo} ariaLabel="Evidence to date" />
            {tab === "evidence" ? (
              <label className="flex min-h-[34px] items-center gap-2 rounded-[10px] border px-3 text-[11.5px] text-[var(--text-secondary)]" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
                <input type="checkbox" checked={disputedOnly} onChange={(event) => setDisputedOnly(event.target.checked)} />
                Disputed only
              </label>
            ) : null}
          </div>
        </div>

        {tab === "evidence" ? (
          evidence.isLoading ? (
            <div className="grid gap-2 p-5">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
          ) : evidence.error ? (
            <div className="p-5"><Notice tone="err">{(evidence.error as Error).message}</Notice></div>
          ) : grouped.length ? (
            <div>
              {grouped.map(([date, rows]) => (
                <section key={date}>
                  <h3 className="border-y px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
                    {formatWorkOsDate(date)} · {rows.length} item{rows.length === 1 ? "" : "s"}
                  </h3>
                  <ul>
                    {rows.map((row) => {
                      const event = row.event ?? null;
                      const screenshot = embeddedRow<AnyRow>(event?.screenshot);
                      const metadata = (event?.metadata ?? {}) as AnyRow;
                      return (
                        <li key={row.id}>
                          <button
                            type="button"
                            onClick={() => { setSelected(row); setScreenshotUrl(null); setScreenshotError(null); }}
                            className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-5 py-3 text-left transition hover:bg-[var(--bg-secondary)]"
                            style={{ borderColor: "var(--border-subtle)" }}
                          >
                            <span className="w-[72px] shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                              {new Date(row.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{row.title}</span>
                              <span className="block truncate text-[11.5px] text-[var(--text-tertiary)]">
                                {row.person?.display_name ?? "Unattributed"}{row.task ? ` · ${row.task.title}` : ""}
                                {row.summary ? ` · ${row.summary.slice(0, 90)}` : ""}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                              {metadata.repository ? <ProvenanceChip>{String(metadata.repository)}</ProvenanceChip> : null}
                              {event?.evidence_class ? <ProvenanceChip>{statusLabel(event.evidence_class)}</ProvenanceChip> : null}
                              <ProvenanceChip>{row.source === "loom" ? "Loom" : row.source}</ProvenanceChip>
                              {event?.correction_status && event.correction_status !== "original" ? <StatusPill tone="warn">{statusLabel(event.correction_status)}</StatusPill> : null}
                              {screenshot && !screenshot.deleted_at ? <StatusPill tone="observed"><Camera size={10} aria-hidden /> Retained</StatusPill> : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="p-5">
              <EmptyState
                icon={ShieldCheck}
                title="No evidence matches these filters"
                body="Widen the date range or clear the source and disputed filters. Evidence appears as providers and manual notes record it."
              />
            </div>
          )
        ) : intervals.isLoading ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
          </div>
        ) : intervals.error ? (
          <div className="p-5"><Notice tone="err">{(intervals.error as Error).message}</Notice></div>
        ) : intervals.data?.intervals.length ? (
          <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {intervals.data.intervals.map((interval) => (
              <li key={interval.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{interval.personName ?? "Unattributed"}</span>
                    <span className="text-[11.5px] tabular-nums text-[var(--text-tertiary)]">{interval.label}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ProvenanceChip>
                      {interval.reviewStatus === "confirmed" ? "Employee confirmed" : interval.reviewStatus === "amended" ? "Employee amended" : "AI-inferred, not reviewed"}
                    </ProvenanceChip>
                    <ProvenanceChip>{interval.evidenceCount} frames</ProvenanceChip>
                  </span>
                </div>
                {interval.headline ? <p className="mt-1.5 text-[13px] font-semibold text-[var(--text-primary)]">{interval.headline}</p> : null}
                {interval.detail ? <p className="mt-1 text-[12.5px] leading-5 text-[var(--text-secondary)]">{interval.detail}</p> : null}
                {interval.employeeFeedback ? (
                  <p className="mt-1 text-[11.5px] text-[var(--text-tertiary)]">Employee note: {interval.employeeFeedback}</p>
                ) : null}
                {interval.evidence.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11.5px] font-semibold" style={{ color: "var(--status-observed)" }}>
                      Evidence · {interval.evidence.length} frame{interval.evidence.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 grid gap-1">
                      {interval.evidence.map((frame, index) => (
                        <li key={`${interval.id}-${index}`} className="flex flex-wrap gap-x-3 text-[11.5px] leading-5 text-[var(--text-secondary)]">
                          <span className="tabular-nums text-[var(--text-tertiary)]">{new Date(frame.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                          {frame.visibleApp ? <span>{frame.visibleApp}</span> : null}
                          {frame.frameSummary ? <span className="min-w-0 flex-1">{frame.frameSummary}</span> : null}
                          {!frame.retained ? <span className="text-[var(--text-tertiary)]">image expired, summary retained</span> : null}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyState icon={Activity} title="No activity recaps in this range" body="Recaps appear when the workspace generates an interval review from retained frames." />
          </div>
        )}
      </AdminCard>

      <GithubReposDrawer open={reposOpen} onClose={() => setReposOpen(false)} />

      <Drawer
        open={!!selected}
        onClose={() => { setSelected(null); setScreenshotUrl(null); setScreenshotError(null); }}
        title={selected?.title ?? "Evidence"}
        subtitle={selected ? `${selected.person?.display_name ?? "Unattributed"} · ${formatWorkOsDate(selected.evidence_date)}` : undefined}
        width={560}
      >
        {selected ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <ProvenanceChip>{selected.source === "loom" ? "Loom recording" : selected.source}</ProvenanceChip>
              {selected.event?.evidence_class ? <ProvenanceChip>{statusLabel(selected.event.evidence_class)}</ProvenanceChip> : null}
              {(() => {
                const metadata = (selected.event?.metadata ?? {}) as AnyRow;
                return (
                  <>
                    {metadata.repository ? <ProvenanceChip>{String(metadata.repository)}</ProvenanceChip> : null}
                    {metadata.event ? <ProvenanceChip>{statusLabel(String(metadata.event))}</ProvenanceChip> : null}
                  </>
                );
              })()}
              {selected.event?.correction_status && selected.event.correction_status !== "original" ? <StatusPill tone="warn">{statusLabel(selected.event.correction_status)}</StatusPill> : null}
              <span className="text-[11px] text-[var(--text-tertiary)]">recorded {relativeTime(selected.created_at)}</span>
            </div>
            {selected.summary ? <p className="text-[13px] leading-6 text-[var(--text-secondary)]">{selected.summary}</p> : <p className="text-[12.5px] text-[var(--text-tertiary)]">No summary was recorded for this item.</p>}
            {selected.task ? (
              <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
                <Link2 size={13} aria-hidden style={{ color: "var(--accent)" }} /> Linked task: {selected.task.title}
              </p>
            ) : null}
            {selected.url ? (
              <a href={selected.url} target="_blank" rel="noreferrer" className="text-[12px] font-semibold" style={{ color: "var(--accent)" }}>Open source artifact</a>
            ) : null}

            {(() => {
              const screenshot = embeddedRow<AnyRow>(selected.event?.screenshot);
              if (!screenshot || screenshot.deleted_at) return null;
              const reviewable = selected.event?.correction_status === "disputed" || selected.event?.metadata?.needsReview === true;
              return (
                <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--status-observed-soft)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-semibold text-[var(--text-primary)]">Retained screenshot</p>
                      <p className="mt-0.5 text-[11px] leading-5 text-[var(--text-tertiary)]">
                        Encrypted, 30-day retention. {reviewable ? "Flagged or disputed items can be opened with a recorded reason." : "Raw access is limited to flagged or disputed review."}
                      </p>
                    </div>
                    {reviewable ? (
                      <Button size="sm" variant="secondary" disabled={screenshotAccess.isPending} onClick={() => screenshotAccess.mutate(screenshot.id)}>
                        <Eye size={12} aria-hidden /> {screenshotAccess.isPending ? "Opening…" : "Open with reason"}
                      </Button>
                    ) : null}
                  </div>
                  {screenshot.summary ? <p className="mt-2 text-[11.5px] leading-5 text-[var(--text-secondary)]">{screenshot.summary}</p> : null}
                  {screenshotError ? <div className="mt-2"><Notice tone="err">{screenshotError}</Notice></div> : null}
                  {screenshotUrl ? (
                    // The screenshot arrives as an in-memory data URI from the
                    // audited access endpoint; next/image cannot optimize it.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={screenshotUrl} alt="Restricted Worktivity screenshot" className="mt-3 max-h-[420px] w-full rounded-lg border object-contain" style={{ borderColor: "var(--border)" }} />
                  ) : null}
                </div>
              );
            })()}

            {selected.metrics && Object.keys(selected.metrics).length ? (
              <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Recorded metrics</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(selected.metrics).slice(0, 8).map(([key, value]) => (
                    <StatusPill key={key} tone="neutral">{statusLabel(key)}: {typeof value === "object" ? "recorded" : String(value)}</StatusPill>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function GithubReposDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const repos = useQuery<GithubIntegrationReposResponse>({
    queryKey: adminKeys.githubRepos(),
    queryFn: () => adminFetch<GithubIntegrationReposResponse>("/api/work-os/admin/integrations/github/repos"),
    enabled: open,
    staleTime: 30_000,
  });
  const connect = useMutation({
    mutationFn: (repo: string) => adminFetch("/api/work-os/admin/integrations/github/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-os"] }),
  });
  const disconnect = useMutation({
    mutationFn: (repo: string) => adminFetch(`/api/work-os/admin/integrations/github/repos?repo=${encodeURIComponent(repo)}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-os"] }),
  });

  const connected = new Set((repos.data?.connectedRepos ?? []).map((entry) => entry.full_name.toLowerCase()));
  const refreshState = connect.isPending || disconnect.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="GitHub repositories"
      subtitle={repos.data?.organization ? `Workspace ${repos.data.organization}` : "Connect GitHub in Settings to manage repositories"}
      width={620}
    >
      {repos.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
        </div>
      ) : repos.error ? (
        <Notice tone="err">{(repos.error as Error).message}</Notice>
      ) : (
        <div className="grid gap-4">
          {repos.data?.webhookUrl ? (
            <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Webhook receiver</p>
              <p className="mt-1 break-all font-mono text-[11px] text-[var(--text-secondary)]">{repos.data.webhookUrl}</p>
            </div>
          ) : null}

          {!repos.data?.configuration.repositoryManagementReady ? (
            <Notice tone="warn">
              {repos.data?.configuration.reason ?? "Repository management is not configured for this deployment."}
              {" "}Create webhooks manually in GitHub with this URL, content type <span className="font-mono">application/json</span>, the deployment&apos;s <span className="font-mono">WORK_OS_GITHUB_WEBHOOK_SECRET</span>, and the events push, pull_request, pull_request_review, workflow_run, deployment_status, and issues.
            </Notice>
          ) : null}

          {connect.error ? <Notice tone="err">{(connect.error as Error).message}</Notice> : null}
          {disconnect.error ? <Notice tone="err">{(disconnect.error as Error).message}</Notice> : null}

          {repos.data?.repos.length ? (
            <ul className="grid gap-2">
              {repos.data.repos.map((repo) => {
                const isConnected = connected.has(repo.full_name.toLowerCase());
                return (
                  <li key={repo.full_name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5" style={{ borderColor: "var(--border-subtle)" }}>
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{repo.full_name}</span>
                      <span className="block text-[11px] text-[var(--text-tertiary)]">
                        {repo.private ? "Private" : "Public"} · default branch {repo.default_branch}{repo.pushed_at ? ` · last push ${relativeTime(repo.pushed_at)}` : ""}
                      </span>
                    </span>
                    {isConnected ? (
                      <span className="flex items-center gap-2">
                        <StatusPill tone="ok">Webhook active</StatusPill>
                        <Button size="sm" variant="ghost" disabled={refreshState} onClick={() => disconnect.mutate(repo.full_name)}>Remove</Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={refreshState} onClick={() => connect.mutate(repo.full_name)}>Connect</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : repos.data?.configuration.repositoryManagementReady ? (
            <EmptyState icon={GitBranch} title="No repositories found" body="The token can read the organization but returned no repositories." />
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
