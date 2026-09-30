"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, Camera, Eye, Link2, ShieldCheck } from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { adminFetch, adminKeys, type ActivityIntervalView, type EvidenceRow } from "./api";
import {
  AdminCard,
  Button,
  Drawer,
  EmptyState,
  Notice,
  ProvenanceChip,
  SegmentedControl,
  SelectField,
  Skeleton,
  StatusPill,
  TextField,
  relativeTime,
  statusLabel,
} from "./ui";

type EvidenceTab = "evidence" | "recaps";

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const SOURCE_OPTIONS = [
  { value: "worktivity", label: "Worktivity (activity)" },
  { value: "github", label: "GitHub" },
  { value: "ghl", label: "GHL" },
  { value: "loom", label: "Loom" },
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Agent" },
  { value: "nifty", label: "Nifty" },
  { value: "crm", label: "CRM" },
  { value: "media", label: "Media" },
];

export default function AdminEvidencePage() {
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

  const people = useQuery<{ people: Array<{ id: string; display_name: string }> }>({
    queryKey: adminKeys.people(),
    queryFn: () => adminFetch("/api/work-os/people"),
    staleTime: 60_000,
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

  return (
    <div className="grid gap-5">
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
                      const screenshot = event?.screenshot ?? null;
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
              const screenshot = selected.event?.screenshot ?? null;
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
