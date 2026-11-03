"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Cable, Check, Eye, GitBranch, Link2, ShieldCheck } from "lucide-react";
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
import { CHART_PALETTE, TrendBars } from "./charts";
import {
  Button,
  DateRangeFilter,
  Drawer,
  EmptyState,
  Group,
  Notice,
  Panel,
  SectionHeading,
  SegmentedControl,
  SelectField,
  Skeleton,
  StateMark,
  StatusPill,
  Switch,
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
  { value: "nifty", label: "Legacy import" },
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
  const [visibleCount, setVisibleCount] = useState(60);

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
  const evidence = useQuery<{
    evidence: EvidenceRow[];
    summary?: { sources: Array<{ source: string; count: number }>; days: Array<{ date: string; count: number }> };
  }>({
    queryKey: adminKeys.evidence(filters),
    queryFn: () => {
      const params = new URLSearchParams({ from, to, limit: "300", summary: "1" });
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

  const visibleGroups = useMemo(() => {
    const result: Array<readonly [string, EvidenceRow[], number]> = [];
    let remaining = visibleCount;
    for (const [date, rows] of grouped) {
      if (remaining <= 0) break;
      const slice = rows.slice(0, Math.max(0, remaining));
      if (!slice.length) continue;
      result.push([date, slice, rows.length] as const);
      remaining -= slice.length;
    }
    return result;
  }, [grouped, visibleCount]);

  const personOptions = (people.data?.people ?? []).map((person) => ({ value: person.id, label: person.display_name }));
  const githubConnection = (connections.data?.connections ?? []).find((row) => row.provider === "github" && row.active !== false) ?? null;
  const githubAccounts = (connections.data?.accounts ?? []).filter((row) => row.provider === "github");
  const actors = githubActors.data?.actors ?? [];
  // Provider bots are automation, not people: mapping one to a teammate would
  // attribute machine work to a person, so they never enter the person queue.
  const isAutomation = (login?: string | null) => !!login && (login.endsWith("[bot]") || /^(dependabot|coderabbitai|github-actions|renovate)/i.test(login));
  const humanActors = actors.filter((actor) => !isAutomation(actor.login));
  const botActors = actors.filter((actor) => isAutomation(actor.login));
  const botEvents = botActors.reduce((sum, actor) => sum + actor.events, 0);

  const totalEvidence = evidence.data?.evidence.length ?? 0;
  const evidenceSources = evidence.data?.summary?.sources ?? [];
  const evidenceDays = evidence.data?.summary?.days ?? [];

  return (
    <div className="flex flex-col">
      <Group label="Shape" detail="What the evidence record holds in this range.">
        {evidenceSources.length || evidenceDays.length ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[var(--text-secondary)]">
              <span className="text-[var(--text-tertiary)]">
                <strong className="text-[22px] font-[590] tracking-[-0.03em] tabular-nums text-[var(--text-primary)]">{evidenceSources.reduce((sum, entry) => sum + entry.count, 0)}</strong> items
              </span>
              {evidenceSources.slice(0, 6).map((entry, index) => (
                <span key={entry.source} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: CHART_PALETTE[index % CHART_PALETTE.length] }} />
                  {entry.source === "worktivity" ? "Worktivity (activity)" : entry.source}
                  <strong className="font-semibold tabular-nums text-[var(--text-primary)]">{entry.count}</strong>
                </span>
              ))}
            </div>
            {evidenceDays.length ? (
              <Panel padded={false} className="p-3.5">
                <TrendBars
                  height={124}
                  ariaLabel="Evidence volume per day in this range"
                  data={evidenceDays.map((entry) => ({ label: entry.date.slice(5).replace("-", "/"), items: entry.count }))}
                  series={[{ key: "items", label: "Evidence items", color: "var(--text-primary)" }]}
                />
                <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">Items recorded per day. Observation is context, never completion.</p>
              </Panel>
            ) : null}
          </div>
        ) : (
          <p className="text-[12.5px] text-[var(--text-tertiary)]">No evidence was recorded in this range.</p>
        )}
      </Group>

      <Group label="Integrations" detail="Provider evidence that feeds this record.">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-[12px] border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <GitBranch size={15} className="text-[var(--text-tertiary)]" aria-hidden /> GitHub
              </span>
              <StateMark tone={githubConnection ? "ok" : "warn"}>{githubConnection ? "Connected" : "Not connected"}</StateMark>
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
                <span className="text-[10.5px] leading-4 text-[var(--text-tertiary)]">
                  {githubActors.data?.configuration.repositoryManagementReady ? "Add or remove repo webhooks here." : "Repository token not configured — see the drawer for manual steps."}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-[12px] border p-4" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)", opacity: 0.72 }} aria-disabled="true">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-primary)]">
                <Cable size={15} className="text-[var(--text-tertiary)]" aria-hidden /> GHL
              </span>
              <StatusPill tone="neutral">Coming soon</StatusPill>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-5 text-[var(--text-tertiary)]">
              Opportunity, appointment, and conversation activity from GoHighLevel becomes output evidence for the mapped person.
            </p>
            <p className="mt-3 text-[10.5px] text-[var(--text-tertiary)]">Opportunities · appointments · conversations</p>
          </div>
        </div>

        {humanActors.length || botActors.length ? (
          <div className="mt-6">
            <SectionHeading
              icon={GitBranch}
              title="Unmapped accounts"
              detail={`${githubActors.data?.totals.unattributedEvents ?? 0} event${(githubActors.data?.totals.unattributedEvents ?? 0) === 1 ? "" : "s"} waiting for a person. Mapping an account also attributes its earlier events.`}
            />
            {humanActors.length ? (
              <ul className="grid">
                {humanActors.map((actor) => {
                  const value = actorPerson[actor.key] ?? actor.suggestion?.personId ?? "";
                  return (
                    <li key={actor.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-3 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                      <span className="min-w-0 flex-1 basis-[220px]">
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
            ) : (
              <p className="text-[12px] text-[var(--text-tertiary)]">No human accounts are waiting for a person.</p>
            )}

            {botActors.length ? (
              <p className="mt-3 border-t pt-3 text-[11px] leading-5 text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
                <span className="font-semibold text-[var(--text-secondary)]">Automation</span> · {botActors.length} account{botActors.length === 1 ? "" : "s"}, {botEvents} event{botEvents === 1 ? "" : "s"} — {botActors.slice(0, 3).map((actor) => actor.login ?? actor.id).join(", ")}{botActors.length > 3 ? ` and ${botActors.length - 3} more` : ""}. Bots are never mapped to a person.
              </p>
            ) : null}

            {mappingReceipt ? <div className="mt-3"><Notice tone="ok">{mappingReceipt}</Notice></div> : null}
            {mapActor.error ? <div className="mt-3"><Notice tone="err">{(mapActor.error as Error).message}</Notice></div> : null}
          </div>
        ) : null}
      </Group>

      <Group label="Record" detail="Evidence and activity recaps, newest first.">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3">
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
            <DateRangeFilter
              from={from}
              to={to}
              onFrom={setFrom}
              onTo={setTo}
              applied={from !== isoDaysAgo(7) || to !== today}
              ariaLabel="Evidence range"
            />
            {tab === "evidence" ? (
              <span className="flex min-h-[34px] items-center rounded-[8px] border px-2.5" style={{ borderColor: "var(--border)", background: "var(--color-paper)" }}>
                <Switch checked={disputedOnly} onChange={setDisputedOnly} label="Disputed only" />
              </span>
            ) : null}
          </div>
        </div>

        <Panel padded={false}>
        {tab === "evidence" ? (
          evidence.isLoading ? (
            <div className="grid gap-2 p-5">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
            </div>
          ) : evidence.error ? (
            <div className="p-5"><Notice tone="err">{(evidence.error as Error).message}</Notice></div>
          ) : grouped.length ? (
            <div>
              {visibleGroups.map(([date, rows, total]) => (
                <section key={date}>
                  <h3 className="border-y px-5 py-2 text-[11.5px] font-medium text-[var(--text-secondary)]" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
                    {formatWorkOsDate(date)} · {total} item{total === 1 ? "" : "s"}
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
                            <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[var(--text-tertiary)]">
                              {metadata.repository ? <span>{String(metadata.repository)}</span> : null}
                              {event?.evidence_class ? <span>{statusLabel(event.evidence_class)}</span> : null}
                              <span>{row.source === "loom" ? "Loom" : row.source}</span>
                              {event?.correction_status && event.correction_status !== "original" ? <StateMark tone="warn">{statusLabel(event.correction_status)}</StateMark> : null}
                              {screenshot && !screenshot.deleted_at ? <StateMark tone="observed">Retained</StateMark> : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {totalEvidence > visibleCount ? (
                <p className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-[var(--text-tertiary)]">
                  <span>Showing {Math.min(visibleCount, totalEvidence)} of {totalEvidence} items.</span>
                  <Button size="sm" onClick={() => setVisibleCount((count) => count + 60)}>Show more</Button>
                </p>
              ) : null}
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
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{interval.personName ?? "Unattributed"}</span>
                    <span className="text-[11.5px] tabular-nums text-[var(--text-tertiary)]">{interval.label}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[var(--text-tertiary)]">
                    <span>
                      {interval.reviewStatus === "confirmed" ? "Employee confirmed" : interval.reviewStatus === "amended" ? "Employee amended" : "AI-inferred, not reviewed"}
                    </span>
                    <span>{interval.evidenceCount} frames</span>
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
        </Panel>
      </Group>

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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
              <span>{selected.source === "loom" ? "Loom recording" : selected.source}</span>
              {selected.event?.evidence_class ? <span>{statusLabel(selected.event.evidence_class)}</span> : null}
              {(() => {
                const metadata = (selected.event?.metadata ?? {}) as AnyRow;
                return (
                  <>
                    {metadata.repository ? <span>{String(metadata.repository)}</span> : null}
                    {metadata.event ? <span>{statusLabel(String(metadata.event))}</span> : null}
                  </>
                );
              })()}
              {selected.event?.correction_status && selected.event.correction_status !== "original" ? <StateMark tone="warn">{statusLabel(selected.event.correction_status)}</StateMark> : null}
              <span>recorded {relativeTime(selected.created_at)}</span>
            </div>
            {selected.summary ? <p className="text-[13px] leading-6 text-[var(--text-secondary)]">{selected.summary}</p> : <p className="text-[12.5px] text-[var(--text-tertiary)]">No summary was recorded for this item.</p>}
            {selected.task ? (
              <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
                <Link2 size={13} aria-hidden className="text-[var(--text-tertiary)]" /> Linked task: {selected.task.title}
              </p>
            ) : null}
            {selected.url ? (
              <a href={selected.url} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">Open source artifact</a>
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
              <div className="border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                <p className="text-[10.5px] text-[var(--text-tertiary)]">Recorded metrics</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--text-secondary)]">
                  {Object.entries(selected.metrics).slice(0, 8).map(([key, value]) => (
                    <span key={key}>
                      {statusLabel(key)} <strong className="font-semibold text-[var(--text-primary)]">{typeof value === "object" ? "recorded" : String(value)}</strong>
                    </span>
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
  const orgWebhook = repos.data?.configuration.orgWebhook === true;

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
            <div className="border-b pb-3" style={{ borderColor: "var(--border-subtle)" }}>
              <p className="text-[10.5px] text-[var(--text-tertiary)]">Webhook receiver</p>
              <p className="mt-1 break-all font-mono text-[11px] text-[var(--text-secondary)]">{repos.data.webhookUrl}</p>
            </div>
          ) : null}

          {orgWebhook ? (
            <Notice tone="ok">
              Organization webhook active — every repository, including new ones, is covered automatically. No per-repository setup is needed.
            </Notice>
          ) : null}

          {!orgWebhook && !repos.data?.configuration.repositoryManagementReady ? (
            <Notice tone="warn">
              {repos.data?.configuration.reason ?? "Repository management is not configured for this deployment."}
              {" "}Create webhooks manually in GitHub with this URL, content type <span className="font-mono">application/json</span>, the deployment&apos;s <span className="font-mono">WORK_OS_GITHUB_WEBHOOK_SECRET</span>, and the events push, pull_request, pull_request_review, workflow_run, deployment_status, and issues.
            </Notice>
          ) : null}

          {connect.error ? <Notice tone="err">{(connect.error as Error).message}</Notice> : null}
          {disconnect.error ? <Notice tone="err">{(disconnect.error as Error).message}</Notice> : null}

          {repos.data?.repos.length ? (
            <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {repos.data.repos.map((repo) => {
                const isConnected = connected.has(repo.full_name.toLowerCase());
                return (
                  <li key={repo.full_name} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-1 last:pb-1">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{repo.full_name}</span>
                      <span className="block text-[11px] text-[var(--text-tertiary)]">
                        {repo.private ? "Private" : "Public"} · default branch {repo.default_branch}{repo.pushed_at ? ` · last push ${relativeTime(repo.pushed_at)}` : ""}
                      </span>
                    </span>
                    {isConnected ? (
                      <span className="flex items-center gap-3">
                        <StateMark tone="ok">Webhook active</StateMark>
                        <Button size="sm" variant="ghost" disabled={refreshState} onClick={() => disconnect.mutate(repo.full_name)}>Remove</Button>
                      </span>
                    ) : orgWebhook ? (
                      <StateMark tone="neutral">Covered by organization</StateMark>
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
