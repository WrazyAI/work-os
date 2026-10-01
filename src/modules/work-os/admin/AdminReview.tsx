"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  Camera,
  Check,
  ChevronDown,
  FileCheck2,
  FilePlus2,
  MessageSquareText,
  ShieldCheck,
  X,
} from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { embeddedRow } from "@/lib/work-os-embed-shape";
import { adminFetch, adminKeys, type ActivityIntervalView, type EvidenceRow, type ReportsResponse, type WorkOsReportRow } from "./api";
import { eodMetricFacts, eodSnippet, parseEodMarkdown } from "./eod";
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
  cx,
  relativeTime,
  statusLabel,
} from "./ui";

type StatusFilter = "pending_review" | "all" | "approved" | "rejected" | "draft";

function statusTone(status: string) {
  if (status === "approved") return "ok" as const;
  if (status === "pending_review") return "info" as const;
  if (status === "rejected") return "err" as const;
  return "neutral" as const;
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function AdminReviewPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [status, setStatus] = useState<StatusFilter>(() => {
    const requested = searchParams.get("status");
    return requested && ["pending_review", "all", "approved", "rejected", "draft"].includes(requested) ? (requested as StatusFilter) : "pending_review";
  });
  const [personId, setPersonId] = useState(() => searchParams.get("personId") ?? "");
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(today);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftPerson, setDraftPerson] = useState("");
  const [draftDate, setDraftDate] = useState(today);

  const filters = { status: status === "all" ? "" : status, personId, from, to };
  const reports = useQuery<ReportsResponse>({
    queryKey: adminKeys.reports(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.personId) params.set("personId", filters.personId);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      params.set("limit", "200");
      return adminFetch<ReportsResponse>(`/api/work-os/reports?${params.toString()}`);
    },
    staleTime: 30_000,
  });
  const people = useQuery<{ people: Array<{ id: string; display_name: string }> }>({
    queryKey: adminKeys.people(),
    queryFn: () => adminFetch("/api/work-os/people"),
    staleTime: 60_000,
  });

  // The queue always has a visible selection: the chosen report, else the first
  // report the filters returned.
  const selected = useMemo(() => {
    const list = reports.data?.reports ?? [];
    return list.find((report) => report.id === selectedId) ?? list[0] ?? null;
  }, [reports.data, selectedId]);

  const draft = useMutation({
    mutationFn: () => adminFetch<{ report: WorkOsReportRow }>("/api/work-os/reports/eod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_id: draftPerson, date: draftDate }),
    }),
    onSuccess: async (result) => {
      setDraftOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["work-os"] });
      if (result.report?.id) {
        setStatus("all");
        setSelectedId(result.report.id);
      }
    },
  });

  const counts = reports.data?.counts;
  const list = reports.data?.reports ?? [];
  const personOptions = (people.data?.people ?? []).map((person) => ({ value: person.id, label: person.display_name }));

  return (
    <div className="grid gap-5">
      <AdminCard padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <SegmentedControl<StatusFilter>
            ariaLabel="Report status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "pending_review", label: `Awaiting review${counts ? ` (${counts.pending_review})` : ""}` },
              { value: "draft", label: `Drafts${counts ? ` (${counts.draft})` : ""}` },
              { value: "rejected", label: `Changes requested${counts ? ` (${counts.rejected})` : ""}` },
              { value: "approved", label: `Approved${counts ? ` (${counts.approved})` : ""}` },
              { value: "all", label: `All${counts ? ` (${counts.total})` : ""}` },
            ]}
          />
          <div className="flex flex-wrap items-end gap-2">
            <SelectField label="Person" value={personId} onChange={setPersonId} options={personOptions} placeholder="All people" ariaLabel="Filter by person" />
            <TextField label="From" type="date" value={from} onChange={setFrom} ariaLabel="Reports from date" />
            <TextField label="To" type="date" value={to} onChange={setTo} ariaLabel="Reports to date" />
            <Button variant="primary" onClick={() => setDraftOpen(true)}>
              <FilePlus2 size={13} aria-hidden /> Draft EOD
            </Button>
          </div>
        </div>
        {reports.error ? <div className="px-5 py-4"><Notice tone="err">{(reports.error as Error).message}</Notice></div> : null}

        <div className="grid lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* Queue */}
          <div className="border-b lg:border-b-0 lg:border-r" style={{ borderColor: "var(--border-subtle)" }}>
            {reports.isLoading ? (
              <div className="grid gap-2 p-4">
                {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}
              </div>
            ) : list.length ? (
              <ul className="max-h-[75vh] overflow-y-auto">
                {list.map((report) => {
                  const active = report.id === selected?.id;
                  const snippet = eodSnippet(report.submitted_markdown ?? report.markdown, 80);
                  return (
                    <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(report.id)}
                        aria-current={active ? "true" : undefined}
                        className={cx("w-full border-b px-4 py-3 text-left transition", !active && "hover:bg-[var(--bg-secondary)]")}
                        style={{ borderColor: "var(--border-subtle)", background: active ? "var(--bg-secondary)" : "transparent" }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{report.person?.display_name ?? "Unmapped person"}</span>
                          <StatusPill tone={statusTone(report.status)}>{statusLabel(report.status)}</StatusPill>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--text-tertiary)]">
                          <span>{formatWorkOsDate(report.report_date)}</span>
                          <span>{report.submitted_at ? `submitted ${relativeTime(report.submitted_at)}` : "not submitted"}</span>
                        </div>
                        {snippet ? <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-4 text-[var(--text-secondary)]">{snippet}</p> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={FileCheck2}
                  title={status === "pending_review" ? "No reports await review" : "No reports match these filters"}
                  body={status === "pending_review" ? "Draft an EOD for a teammate or widen the date range." : "Clear the filters or widen the date range."}
                />
              </div>
            )}
          </div>

          {/* Detail */}
          <div className="min-w-0 p-5">
            {!selected ? (
              <EmptyState icon={MessageSquareText} title="Select a report" body="Choose a report from the queue to read it, check its evidence, and record a decision." />
            ) : (
              <ReviewDetail key={selected.id} report={selected} />
            )}
          </div>
        </div>
      </AdminCard>

      <Drawer open={draftOpen} onClose={() => setDraftOpen(false)} title="Draft an EOD report" subtitle="Generate a report from the day's recorded work. Nothing is submitted to the employee until they review it." width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDraftOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!draftPerson || !draftDate || draft.isPending} onClick={() => draft.mutate()}>
              {draft.isPending ? "Drafting…" : "Draft report"}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <SelectField label="Person" value={draftPerson} onChange={setDraftPerson} options={personOptions} placeholder="Select a teammate" ariaLabel="Person for the draft" />
          <TextField label="Report date" type="date" value={draftDate} onChange={setDraftDate} ariaLabel="Report date" />
          {draft.error ? <Notice tone="err">{(draft.error as Error).message}</Notice> : null}
        </div>
      </Drawer>
    </div>
  );
}

function ReviewDetail({ report }: { report: WorkOsReportRow }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(report.manager_notes ?? "");
  const [managerMarkdown, setManagerMarkdown] = useState(report.submitted_markdown ?? report.markdown ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const evidence = useQuery<{ evidence: EvidenceRow[] }>({
    queryKey: adminKeys.evidence({ personId: report.person_id ?? "", date: report.report_date }),
    queryFn: () => adminFetch(`/api/work-os/evidence?personId=${report.person_id}&date=${report.report_date}&limit=100`),
    enabled: !!report.person_id,
    staleTime: 60_000,
  });
  const intervals = useQuery<{ intervals: Array<ActivityIntervalView & { personId: string; personName: string | null }> }>({
    queryKey: adminKeys.intervals(report.report_date, report.report_date, report.person_id ?? ""),
    queryFn: () => adminFetch(`/api/work-os/admin/activity-intervals?personId=${report.person_id}&from=${report.report_date}&to=${report.report_date}&limit=40`),
    enabled: !!report.person_id,
    staleTime: 60_000,
  });
  const review = useMutation({
    mutationFn: (nextStatus: "approved" | "rejected") => adminFetch(`/api/work-os/reports/${report.id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus, markdown: managerMarkdown, manager_notes: notes }),
    }),
    onSuccess: (_result, nextStatus) => {
      setReceipt(nextStatus === "approved" ? "The report was approved." : "Changes were requested from the employee.");
      void queryClient.invalidateQueries({ queryKey: ["work-os"] });
    },
  });

  const document = parseEodMarkdown(report.submitted_markdown ?? report.markdown);
  const metricFacts = eodMetricFacts(report.metrics);

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-[var(--text-primary)]">{report.person?.display_name ?? "Unmapped person"}</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
            {report.title || `EOD report · ${formatWorkOsDate(report.report_date)}`}
            {report.submitted_at ? ` · submitted ${relativeTime(report.submitted_at)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={statusTone(report.status)}>{statusLabel(report.status)}</StatusPill>
          <Button
            variant="secondary"
            size="sm"
            disabled={review.isPending || report.status !== "pending_review"}
            title={report.status === "pending_review" ? undefined : "Only reports awaiting review can be decided"}
            onClick={() => review.mutate("rejected")}
          >
            <X size={12} aria-hidden /> Request changes
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={review.isPending || report.status !== "pending_review"}
            title={report.status === "pending_review" ? undefined : "Only reports awaiting review can be decided"}
            onClick={() => review.mutate("approved")}
          >
            <Check size={12} aria-hidden /> Approve
          </Button>
        </div>
      </header>
      {review.error ? <Notice tone="err">{(review.error as Error).message}</Notice> : null}
      {receipt ? <Notice tone="ok">{receipt}</Notice> : null}

      {metricFacts.length ? (
        <div className="flex flex-wrap gap-2">
          {metricFacts.map((fact) => (
            <StatusPill key={fact.label} tone="neutral">{fact.label}: {fact.value}</StatusPill>
          ))}
          <StatusPill tone="observed"><Camera size={11} aria-hidden /> {evidence.data?.evidence.length ?? 0} evidence items</StatusPill>
        </div>
      ) : null}

      <AdminCard>
        <div className="grid gap-5">
          {document.meta.length ? (
            <dl className="grid gap-2 sm:grid-cols-2">
              {document.meta.map((meta) => (
                <div key={meta.label} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{meta.label}</dt>
                  <dd className="mt-0.5 text-[12.5px] text-[var(--text-primary)]">{meta.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {document.sections.map((section) => (
            <section key={section.heading} className="grid gap-2">
              <h3 className={cx("text-[12px] font-semibold uppercase tracking-[0.08em]", /activity context/i.test(section.heading) ? "text-[var(--status-observed)]" : "text-[var(--text-tertiary)]")}>
                {section.heading}
              </h3>
              <ul className="grid gap-1.5">
                {section.lines.map((line, index) => (
                  <li
                    key={`${section.heading}-${index}`}
                    className={cx("text-[13px] leading-6", line.kind === "note" ? "text-[var(--text-tertiary)]" : "text-[var(--text-secondary)]")}
                  >
                    {line.kind === "bullet" ? <span className="mr-2 inline-block size-1.5 rounded-full align-middle" style={{ background: "var(--accent)" }} aria-hidden /> : null}
                    {line.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {document.closing ? <p className="border-t pt-3 text-[11.5px] leading-5 text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>{document.closing}</p> : null}
        </div>
      </AdminCard>

      <AdminCard>
        <SectionHeading icon={Camera} title="Sourced evidence" detail="What the day's record captured alongside the report." />
        {evidence.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : evidence.data?.evidence.length ? (
          <ul className="grid gap-2">
            {evidence.data.evidence.map((item) => {
              const event = item.event ?? null;
              const screenshot = embeddedRow<Record<string, any>>(event?.screenshot);
              return (
                <li key={item.id} className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{item.title}</span>
                    <span className="flex items-center gap-1.5">
                      {event?.evidence_class ? <ProvenanceChip>{statusLabel(event.evidence_class)}</ProvenanceChip> : null}
                      <ProvenanceChip>{item.source === "loom" ? "Loom recording" : item.source}</ProvenanceChip>
                      {event?.correction_status && event.correction_status !== "original" ? <StatusPill tone="warn">{statusLabel(event.correction_status)}</StatusPill> : null}
                      {screenshot && !screenshot.deleted_at ? <StatusPill tone="observed">Screenshot retained</StatusPill> : null}
                    </span>
                  </div>
                  {item.summary ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{item.summary}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-[var(--text-tertiary)]">No evidence is linked to this report date.</p>
        )}
      </AdminCard>

      <AdminCard>
        <SectionHeading icon={Activity} title="Activity context" detail="Interval recaps recorded for this workday. Observed context only — it never proves completion." />
        {intervals.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : intervals.data?.intervals.length ? (
          <ul className="grid gap-3">
            {intervals.data.intervals.map((interval) => (
              <li key={interval.id} className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--status-observed-soft)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--status-observed)]">{interval.label}</span>
                  <span className="flex items-center gap-1.5">
                    <ProvenanceChip>
                      {interval.reviewStatus === "confirmed" ? "Employee confirmed" : interval.reviewStatus === "amended" ? "Employee amended" : "AI-inferred, not reviewed"}
                    </ProvenanceChip>
                    <ProvenanceChip>{interval.evidenceCount} frames</ProvenanceChip>
                  </span>
                </div>
                {interval.headline ? <p className="mt-1.5 text-[13px] font-semibold text-[var(--text-primary)]">{interval.headline}</p> : null}
                {interval.detail ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{interval.detail}</p> : null}
                {interval.evidence.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-semibold text-[var(--status-observed)]">
                      Evidence · {interval.evidence.length} frame{interval.evidence.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1.5 grid gap-1">
                      {interval.evidence.map((frame, index) => (
                        <li key={`${interval.id}-${index}`} className="text-[11px] leading-5 text-[var(--text-secondary)]">
                          <span className="tabular-nums text-[var(--text-tertiary)]">{new Date(frame.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                          {frame.visibleApp ? ` · ${frame.visibleApp}` : ""}
                          {frame.frameSummary ? ` — ${frame.frameSummary}` : ""}
                          {!frame.retained ? " · image expired, summary retained" : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-[var(--text-tertiary)]">No activity recaps were recorded for this workday.</p>
        )}
      </AdminCard>

      <AdminCard>
        <SectionHeading icon={ShieldCheck} title="Decision record" detail="Notes and an optional manager version are saved with the decision." />
        <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
          Manager notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Context for the decision, follow-ups, or coaching notes."
            className="w-full resize-y rounded-[10px] border bg-transparent px-3 py-2 text-[12.5px] font-normal normal-case tracking-normal text-[var(--text-primary)] outline-none"
            style={{ borderColor: "var(--border)" }}
          />
        </label>
        <button
          type="button"
          onClick={() => setEditorOpen((value) => !value)}
          className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-semibold"
          style={{ color: "var(--accent)" }}
          aria-expanded={editorOpen}
        >
          <ChevronDown size={13} className={cx("transition", editorOpen && "rotate-180")} aria-hidden />
          {editorOpen ? "Hide manager version" : "Edit manager version"}
        </button>
        {editorOpen ? (
          <textarea
            value={managerMarkdown}
            onChange={(event) => setManagerMarkdown(event.target.value)}
            rows={14}
            className="mt-2 w-full resize-y rounded-[10px] border bg-transparent px-3 py-2 font-mono text-[11.5px] leading-5 text-[var(--text-primary)] outline-none"
            style={{ borderColor: "var(--border)" }}
            aria-label="Manager version markdown"
          />
        ) : null}
        {report.versions?.length ? (
          <ul className="mt-3 grid gap-1 border-t pt-3 text-[11.5px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
            {report.versions.map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-2">
                <span>{statusLabel(version.version_kind)}</span>
                <span>{relativeTime(version.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </AdminCard>

      <details className="text-[11.5px] text-[var(--text-tertiary)]">
        <summary className="cursor-pointer font-semibold">View original markdown</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border p-3 text-[11px] leading-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>
          {report.submitted_markdown ?? report.markdown}
        </pre>
      </details>
    </div>
  );
}
