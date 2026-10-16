import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Camera, Check, FileCheck2, FilePlus2, Filter, ScrollText, X } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import { formatWorkOsFullDate } from "../dateFormat";
import {
  adminKeys,
  ADMIN_DETAIL_STALE_MS,
  ADMIN_STALE_MS,
  draftAdminReport,
  fetchAdminReports,
  fetchPeople,
  fetchReportEvidence,
  fetchReportIntervals,
  normalizeEvidence,
  normalizeIntervals,
  normalizePeople,
  normalizeReports,
  relativeTime,
  reportTone,
  statusLabel,
  isoDaysAgo,
  todayIso,
  reviewAdminReport,
} from "./data";
import { parseEodMarkdown, eodMetricFacts, eodSnippet } from "./eod";
import { AdminButton, AdminCard, AdminControls, AdminControlsGroup, Avatar, Drawer, Notice, Pill, Segmented, SelectField, Skeleton, TextField } from "./ui";
import type { ReportsResponse, WorkOsReportRow } from "./types";

type StatusFilter = "pending_review" | "all" | "approved" | "rejected" | "draft";

/** The queue reads newest first. A report's submission time is its clock; a
 * row that was never submitted falls back to its report date so a draft keeps
 * its day's place instead of jumping the queue. Rows missing both keys sort
 * last, and equal clocks break by report date then id so the order never
 * jitters. This is the queue's one deliberate order — there are no
 * click-to-sort headers here (design.md §16.2). */
export function sortReportsNewestFirst(reports: WorkOsReportRow[]): WorkOsReportRow[] {
  const clock = (report: WorkOsReportRow): string | null => {
    if (report.submitted_at) return report.submitted_at;
    if (!report.report_date) return null;
    return report.report_date.includes("T") ? report.report_date : `${report.report_date}T00:00:00.000Z`;
  };
  return [...reports].sort((a, b) => {
    const aClock = clock(a);
    const bClock = clock(b);
    if (aClock !== bClock) {
      if (aClock === null) return 1;
      if (bClock === null) return -1;
      return aClock < bClock ? 1 : -1;
    }
    if (a.report_date !== b.report_date) return a.report_date < b.report_date ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
}

/** The queue's one range filter: an icon-only filter-cone button that sits on
 * the controls row beside the status views and expands a small popup with the
 * native From/To pickers. The popup anchors under the button, clamps to the
 * viewport (and flips above the button when there is no room below), closes
 * on Escape, an outside press, or Done, and returns focus to the button. The
 * applied range lives in the popup's inputs, so the card's detail line stays
 * counts only, and the button reads its own state quietly: a small accent dot
 * while a range other than the 30-day default is applied (design.md §8.2,
 * §16.2). */
export function ReportRangeControl({ from, to, onFromChange, onToChange, initialOpen = false }: {
  from: string;
  to: string;
  onFromChange: (next: string) => void;
  onToChange: (next: string) => void;
  /** Render-test seam: mounts with the popup open, as if the button was pressed. */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // A press that lands on another control keeps that control's focus; every
  // other close path returns focus to the range button (design.md §12).
  const keepFocus = useRef(false);
  const rangeLabel = `${formatWorkOsFullDate(from)} – ${formatWorkOsFullDate(to)}`;
  // The button's quiet applied state: the default range (30 days back →
  // today, the pair the queue seeds its state with) stays plain, and any
  // other range raises the accent dot. The default is captured at mount so a
  // date rollover while the page stays open never fakes an applied filter.
  const [defaultRange] = useState(() => ({ from: isoDaysAgo(30), to: todayIso() }));
  const isDefaultRange = from === defaultRange.from && to === defaultRange.to;

  useEffect(() => {
    if (!open) return;
    popupRef.current?.querySelector<HTMLElement>("input")?.focus();
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
      } else if (event instanceof PointerEvent) {
        const target = event.target;
        if (wrapRef.current && target instanceof Node && wrapRef.current.contains(target)) return;
        const onOtherControl = target instanceof Element && !!target.closest("button, a, input, select, textarea, [tabindex]");
        keepFocus.current = onOtherControl;
        // Cancelling the pointer default stops the browser from blurring the
        // popup to the body, so the focus restore lands back on the button
        // (the same reason the drawer's backdrop cancels it). A press on
        // another control is left alone so that control still takes focus.
        if (!onOtherControl) event.preventDefault();
      } else {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
      if (!keepFocus.current) buttonRef.current?.focus();
      keepFocus.current = false;
    };
  }, [open]);

  // The popup measures itself once open: the inline axis is clamped so the
  // popup never leaves the viewport, and it flips above the button when the
  // space below is too small for it.
  useLayoutEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    const wrap = wrapRef.current;
    if (!popup || !wrap) return;
    const place = () => {
      const rect = wrap.getBoundingClientRect();
      const margin = 12;
      // Clamp the popup's viewport box to [margin, innerWidth - margin]; when
      // the button sits near the right edge the popup slides left of it (it
      // may extend past the card, but never past the window).
      const minLeft = margin - rect.left;
      const maxLeft = window.innerWidth - margin - rect.left - popup.offsetWidth;
      popup.style.left = `${Math.min(Math.max(minLeft, 0), maxLeft)}px`;
      const below = window.innerHeight - rect.bottom;
      if (below < popup.offsetHeight + margin + 6 && rect.top > popup.offsetHeight + margin + 6) {
        popup.style.top = "auto";
        popup.style.bottom = `${rect.height + 6}px`;
      } else {
        popup.style.top = `${rect.height + 6}px`;
        popup.style.bottom = "auto";
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  return (
    <div className="admin-range" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`admin-range-button${isDefaultRange ? "" : " is-active"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Filter reports by date range: ${rangeLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <Filter size={14} aria-hidden />
      </button>
      {open ? (
        <div className="admin-range-popup" role="dialog" aria-label="Report date range" ref={popupRef}>
          <div className="admin-range-fields">
            <TextField label="From" type="date" value={from} onChange={onFromChange} ariaLabel="Reports from date" />
            <TextField label="To" type="date" value={to} onChange={onToChange} ariaLabel="Reports to date" />
          </div>
          <div className="admin-range-actions">
            <AdminButton variant="primary" onClick={() => setOpen(false)}>Done</AdminButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** EOD review: the queue, the report as a structured document beside its
 * sourced evidence and interval recaps, and the decision record. */
export default function ReviewPage({ initialReportId }: { initialReportId?: string }) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  // A deep link (a report opened from a person's update) starts on the full
  // list so the requested record is present whatever its status; the queue
  // keeps its awaiting-review default otherwise.
  const [status, setStatus] = useState<StatusFilter>(initialReportId ? "all" : "pending_review");
  const [personId, setPersonId] = useState("");
  const [from, setFrom] = useState(() => isoDaysAgo(30));
  const [to, setTo] = useState(() => todayIso());
  const [selectedId, setSelectedId] = useState<string | null>(initialReportId ?? null);
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [draftPerson, setDraftPerson] = useState("");
  const [draftDate, setDraftDate] = useState(() => todayIso());

  const filters = useMemo(() => ({
    status: status === "all" ? "" : status,
    personId,
    from,
    to,
  }), [status, personId, from, to]);
  const reports = useQuery<ReportsResponse>({
    queryKey: adminKeys.reports(filters),
    queryFn: () => fetchAdminReports(filters),
    select: normalizeReports,
    staleTime: 30_000,
  });
  const people = useQuery({
    queryKey: adminKeys.people(),
    queryFn: fetchPeople,
    select: normalizePeople,
    staleTime: ADMIN_STALE_MS,
  });

  // The queue's one deliberate order: newest submission first (see
  // `sortReportsNewestFirst`). A deep link still finds its record by id
  // whatever its place in the order.
  const list = useMemo(() => sortReportsNewestFirst(reports.data?.reports ?? []), [reports.data]);
  const selected = useMemo(() => list.find((report) => report.id === selectedId) ?? null, [list, selectedId]);

  const review = useMutation({
    mutationFn: ({ reportId, next, managerNotes }: { reportId: string; next: "approved" | "rejected"; managerNotes: string }) =>
      reviewAdminReport(reportId, { status: next, manager_notes: managerNotes.trim() || undefined }),
    onSuccess: (result, variables) => {
      setReceipt(variables.next === "approved" ? "The report was approved." : "Changes were requested from the employee.");
      setNotes("");
      void queryClient.invalidateQueries({ queryKey: ["work-os", "admin"] });
      // The receipt names the person the persisted report carries, falling
      // back to the row the decision was taken from.
      const name = result.report?.person?.display_name ?? selected?.person?.display_name ?? null;
      if (variables.next === "approved") {
        notifications.success(name ? `${name}'s EOD report was approved.` : "The EOD report was approved.", "Report approved");
      } else {
        notifications.success(name ? `Changes were requested from ${name}.` : "Changes were requested from the employee.", "Changes requested");
      }
    },
  });
  const draft = useMutation({
    mutationFn: () => draftAdminReport(draftPerson, draftDate),
    onSuccess: async (result) => {
      setReceipt(`A draft for ${formatWorkOsFullDate(draftDate)} is ready to review.`);
      await queryClient.invalidateQueries({ queryKey: ["work-os", "admin"] });
      setStatus("all");
      if (result.report?.id) setSelectedId(result.report.id);
      notifications.success(`A draft for ${formatWorkOsFullDate(draftDate)} is ready to review.`, "EOD draft created");
    },
  });

  const counts = reports.data?.counts;
  const personOptions = (people.data?.people ?? []).map((person) => ({ value: String(person.id), label: String(person.display_name ?? "Unnamed") }));
  const pendingOnly = selected?.status === "pending_review";

  return (
    <div className="admin-grid">
      <AdminCard
        icon={ScrollText}
        title="Review queue"
        detail={counts ? `${counts.pending_review} awaiting review · ${counts.draft} draft${counts.draft === 1 ? "" : "s"} · ${counts.approved} approved · ${counts.rejected} returned` : undefined}
        padded={false}
        controls={
          <>
            {/* One controls row: the status views first, the range filter cone
                next to them, the person filter after. The range text lives in
                the popup's inputs, so the detail line stays counts only
                (design.md §8.2, §16.2). */}
            <AdminControls>
              <AdminControlsGroup>
                <Segmented<StatusFilter>
                  ariaLabel="Report status"
                  value={status}
                  onChange={(next) => { setStatus(next); setSelectedId(null); setReceipt(null); }}
                  options={[
                    { value: "pending_review", label: "Awaiting review", count: counts?.pending_review },
                    { value: "draft", label: "Drafts", count: counts?.draft },
                    { value: "rejected", label: "Changes requested", count: counts?.rejected },
                    { value: "approved", label: "Approved", count: counts?.approved },
                    { value: "all", label: "All", count: counts?.total },
                  ]}
                />
              </AdminControlsGroup>
              <AdminControlsGroup className="is-range">
                <ReportRangeControl from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
              </AdminControlsGroup>
              <AdminControlsGroup end>
                <SelectField ariaLabel="Filter by person" value={personId} onChange={setPersonId} placeholder="All people" options={personOptions} />
              </AdminControlsGroup>
            </AdminControls>
          </>
        }
      >
        {reports.isLoading ? (
          <div className="admin-card-body is-padded"><div className="admin-grid"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div></div>
        ) : reports.error ? (
          <div className="admin-card-body is-padded"><Notice tone="err">{(reports.error as Error).message}</Notice></div>
        ) : list.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Person</th><th>Report</th><th>Date</th><th>Status</th><th>Submitted</th></tr></thead>
              <tbody>
                {list.map((report) => (
                  <tr
                    key={report.id}
                    className={selectedId === report.id ? "selected" : undefined}
                    onClick={() => { setSelectedId(report.id); setNotes(""); setReceipt(null); }}
                    tabIndex={0}
                    onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(report.id); }}
                  >
                    <td>
                      <span className="admin-person">
                        <Avatar name={report.person?.display_name ?? "Unmapped"} size={28} />
                        <span className="min-w-0"><b>{report.person?.display_name ?? "Unmapped person"}</b><small>{report.title || `EOD · ${formatWorkOsFullDate(report.report_date)}`}</small></span>
                      </span>
                    </td>
                    <td className="admin-quiet">{eodSnippet(report.submitted_markdown ?? report.markdown) ?? "No facts recorded"}</td>
                    <td>{formatWorkOsFullDate(report.report_date)}</td>
                    <td><Pill tone={reportTone(report.status)}>{statusLabel(report.status)}</Pill></td>
                    <td className="admin-quiet">{report.submitted_at ? relativeTime(report.submitted_at) : "not submitted"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-card-body is-padded"><p className="admin-empty-note">No reports match these filters.</p></div>
        )}
      </AdminCard>

      <AdminCard icon={FilePlus2} title="Draft a report" detail="Rebuild a day's structured EOD from the record, for review">
        <div className="admin-inline-fields">
          <SelectField label="Person" ariaLabel="Draft report person" value={draftPerson} onChange={setDraftPerson} placeholder="Select a person" options={personOptions} />
          <TextField label="Date" type="date" value={draftDate} onChange={setDraftDate} ariaLabel="Draft report date" />
          <AdminButton variant="primary" icon={FilePlus2} disabled={!draftPerson || draft.isPending} onClick={() => draft.mutate()}>
            {draft.isPending ? "Drafting…" : "Draft report"}
          </AdminButton>
        </div>
        {draft.error ? <Notice tone="err">{(draft.error as Error).message}</Notice> : null}
        {receipt ? <Notice tone="ok">{receipt}</Notice> : null}
      </AdminCard>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.person?.display_name ?? "Report"}
        subtitle={selected ? `${selected.title || `EOD report · ${formatWorkOsFullDate(selected.report_date)}`}${selected.submitted_at ? ` · submitted ${relativeTime(selected.submitted_at)}` : ""}` : undefined}
        width={680}
        footer={selected ? (
          <div className="admin-decision">
            <TextField label="Notes for the employee" value={notes} onChange={setNotes} ariaLabel="Manager notes" placeholder="What to keep, what to change" />
            <div className="admin-decision-actions">
              <AdminButton
                variant="secondary"
                icon={X}
                disabled={!pendingOnly || review.isPending}
                title={pendingOnly ? undefined : "Only reports awaiting review can be decided"}
                onClick={() => review.mutate({ reportId: selected.id, next: "rejected", managerNotes: notes })}
              >
                Request changes
              </AdminButton>
              <AdminButton
                variant="primary"
                icon={Check}
                disabled={!pendingOnly || review.isPending}
                title={pendingOnly ? undefined : "Only reports awaiting review can be decided"}
                onClick={() => review.mutate({ reportId: selected.id, next: "approved", managerNotes: notes })}
              >
                {review.isPending ? "Saving…" : "Approve"}
              </AdminButton>
            </div>
            {review.error ? <Notice tone="err">{(review.error as Error).message}</Notice> : null}
          </div>
        ) : null}
      >
        {selected ? <ReportBody report={selected} /> : null}
      </Drawer>
    </div>
  );
}

function ReportBody({ report }: { report: WorkOsReportRow }) {
  const document = parseEodMarkdown(report.submitted_markdown ?? report.markdown);
  const facts = eodMetricFacts(report.metrics);
  const evidence = useQuery({
    queryKey: adminKeys.reportEvidence(report.person_id ?? "", report.report_date),
    queryFn: () => fetchReportEvidence(report.person_id!, report.report_date),
    select: normalizeEvidence,
    enabled: !!report.person_id,
    staleTime: ADMIN_DETAIL_STALE_MS,
  });
  const intervals = useQuery({
    queryKey: adminKeys.reportIntervals(report.person_id ?? "", report.report_date),
    queryFn: () => fetchReportIntervals(report.person_id!, report.report_date),
    select: normalizeIntervals,
    enabled: !!report.person_id,
    staleTime: ADMIN_DETAIL_STALE_MS,
  });

  return (
    <div className="admin-grid admin-drawer-grid">
      <div className="admin-chips">
        <Pill tone={reportTone(report.status)}>{statusLabel(report.status)}</Pill>
        {facts.map((fact) => <Pill key={fact.label}>{fact.label}: {fact.value}</Pill>)}
        <Pill tone="observed" icon={Camera}>{(evidence.data?.evidence ?? []).length} evidence items</Pill>
        {report.manager_notes ? <Pill tone="info">Notes on record</Pill> : null}
      </div>

      {document.meta.length ? (
        <section className="admin-block">
          <div className="admin-kv-grid">
            {document.meta.map((meta) => (
              <div className="admin-kv" key={meta.label}><span>{meta.label}</span><b>{meta.value}</b></div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="admin-block">
        {document.sections.map((section) => (
          <div key={section.heading} className="admin-report-section">
            <h3 className={/activity context/i.test(section.heading) ? "is-observed" : undefined}>{section.heading}</h3>
            <ul>
              {section.lines.map((line, index) => (
                <li key={`${section.heading}-${index}`} className={line.kind === "note" ? "note" : undefined}>
                  {line.kind === "bullet" ? <span className="admin-dot ok" aria-hidden /> : null}
                  {line.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {document.closing ? <p className="admin-quiet">{document.closing}</p> : null}
      </section>

      <section className="admin-block">
        <h3><Camera size={14} aria-hidden /> Sourced evidence</h3>
        {evidence.isLoading ? (
          <Skeleton className="h-20" />
        ) : (evidence.data?.evidence ?? []).length ? (
          <ul className="admin-rows">
            {(evidence.data?.evidence ?? []).slice(0, 10).map((item) => (
              <li key={item.id}>
                <span>{item.title}<small>{item.summary}</small></span>
                <Pill tone={item.source === "worktivity" ? "observed" : "neutral"}>{statusLabel(item.source)}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty-note">No evidence rows were recorded for this day.</p>
        )}
      </section>

      <section className="admin-block">
        <h3><Activity size={14} aria-hidden /> Interval recaps</h3>
        {intervals.isLoading ? (
          <Skeleton className="h-20" />
        ) : (intervals.data?.intervals ?? []).length ? (
          <ul className="admin-rows">
            {(intervals.data?.intervals ?? []).slice(0, 8).map((interval) => (
              <li key={interval.id}>
                <span>{interval.headline ?? "Interval"}<small>{interval.label} · {statusLabel(interval.reviewStatus)} · {interval.evidenceCount} evidence</small></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty-note">No interval recaps were recorded for this day.</p>
        )}
      </section>

      <details className="admin-details">
        <summary>Raw report text</summary>
        <pre>{report.submitted_markdown ?? report.markdown}</pre>
      </details>
      {report.versions?.length ? (
        <details className="admin-details">
          <summary>Versions ({report.versions.length})</summary>
          <ul className="admin-rows">
            {report.versions.map((version) => (
              <li key={version.id}><span>{statusLabel(version.version_kind)}</span><small>{relativeTime(version.created_at)}</small></li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
