import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowUpRight, Camera, Check, ChevronDown, FileCheck2, FilePlus2, FileText, Filter, Github, ScrollText, Video, X, type LucideIcon } from "lucide-react";
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
import EodSectionIcon from "../EodSectionIcon";
import { ScreenshotImage } from "../ScreenshotGallery";
import { AdminButton, AdminCard, AdminControls, AdminControlsGroup, Avatar, Drawer, Notice, Pill, Segmented, SelectField, Skeleton, TextField } from "./ui";
import { one, type EvidenceRow, type EvidenceResponse, type ReportsResponse, type WorkOsReportRow } from "./types";

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
export default function ReviewPage({ initialReportId, initialPersonId, onOpenEvidence, onOpenRecaps }: {
  initialReportId?: string;
  initialPersonId?: string;
  onOpenEvidence?: (personId: string) => void;
  onOpenRecaps?: () => void;
}) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  // A deep link (a report opened from a person's record) starts on the full
  // list so the requested record is present whatever its status; the queue
  // keeps its awaiting-review default otherwise.
  const deepLinked = Boolean(initialReportId || initialPersonId);
  const [status, setStatus] = useState<StatusFilter>(deepLinked ? "all" : "pending_review");
  const [personId, setPersonId] = useState(initialPersonId ?? "");
  // A person's "View all reports" action reaches past the queue's default
  // thirty-day window so it can show every report the drawer listed.
  const [from, setFrom] = useState(() => isoDaysAgo(deepLinked ? 365 : 30));
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
                  >
                    <td data-label="Person">
                      <span className="admin-person">
                        <Avatar name={report.person?.display_name ?? "Unmapped"} size={28} />
                        <span className="min-w-0"><b><button type="button" className="admin-record-open" aria-label={`Open ${report.person?.display_name ?? "unmapped person"} report`} onClick={(event) => { event.stopPropagation(); setSelectedId(report.id); setNotes(""); setReceipt(null); }}>{report.person?.display_name ?? "Unmapped person"}</button></b><small>{report.title || `EOD · ${formatWorkOsFullDate(report.report_date)}`}</small></span>
                      </span>
                    </td>
                    <td data-label="Report" className="admin-quiet">{eodSnippet(report.submitted_markdown ?? report.markdown) ?? "No facts recorded"}</td>
                    <td data-label="Date">{formatWorkOsFullDate(report.report_date)}</td>
                    <td data-label="Status"><Pill tone={reportTone(report.status)}>{statusLabel(report.status)}</Pill></td>
                    <td data-label="Submitted" className="admin-quiet">{report.submitted_at ? relativeTime(report.submitted_at) : "not submitted"}</td>
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
          <AdminButton variant="primary" icon={FilePlus2} disabled={!draftPerson || draft.isPending} title={!draftPerson ? "Choose a teammate to enable drafting" : undefined} onClick={() => draft.mutate()}>
            {draft.isPending ? "Drafting…" : "Draft report"}
          </AdminButton>
        </div>
        {!draftPerson ? <p className="admin-field-hint">Choose a teammate to enable drafting.</p> : null}
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
        {selected ? <ReportBody key={selected.id} report={selected} onOpenEvidence={onOpenEvidence} onOpenRecaps={onOpenRecaps} /> : null}
      </Drawer>
    </div>
  );
}

export function screenshotOf(row: EvidenceRow): { summaryId: string; title: string } | null {
  const shot = one<{ id?: unknown; deleted_at?: unknown }>(row.event?.screenshot);
  if (!shot || shot.deleted_at) return null;
  const summaryId = typeof shot.id === "string" ? shot.id : "";
  return summaryId ? { summaryId, title: row.title } : null;
}

function EvidencePreviewDialog({ preview, onClose }: { preview: { summaryId: string; title: string }; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const closeHandler = useRef(onClose);
  useEffect(() => {
    closeHandler.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeHandler.current();
        return;
      }
      // The dialog has one focusable control. Keep Tab on it instead of
      // letting focus drift behind the drawer.
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    // Capture so the drawer's own Escape listener cannot close the report
    // underneath this topmost dialog.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="admin-shot-modal"
      role="dialog"
      aria-modal="true"
      aria-label={preview.title}
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) closeHandler.current(); }}
    >
      <div className="admin-shot-dialog">
        <header>
          <strong>{preview.title}</strong>
          <button ref={closeRef} type="button" className="admin-shot-close" aria-label="Close evidence preview" onClick={() => closeHandler.current()}>
            <X size={16} aria-hidden />
          </button>
        </header>
        <ScreenshotImage
          summaryId={preview.summaryId}
          size="preview"
          alt={`Evidence frame: ${preview.title}`}
          unavailableLabel="This frame is not available to your account"
        />
      </div>
    </div>
  );
}

/** One animated disclosure. The body is mounted only after the first open and
 * unmounted after the close transition, so its query and images do not sit in
 * memory while the drawer is collapsed. */
function AdminAccordion({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const headingId = useId();
  const bodyId = useId();
  const timer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (frame.current) window.cancelAnimationFrame(frame.current);
  }, []);
  const toggle = () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (frame.current) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (open) {
      setOpen(false);
      timer.current = window.setTimeout(() => setMounted(false), 220);
      return;
    }
    setMounted(true);
    frame.current = window.requestAnimationFrame(() => { frame.current = null; setOpen(true); });
  };
  return (
    <section className={`admin-accordion ${open ? "is-open" : ""}`}>
      <button type="button" className="admin-accordion-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span className="admin-accordion-title"><Icon size={13} aria-hidden /><span id={headingId}>{title}</span></span>
        <ChevronDown size={14} className="admin-accordion-chevron" aria-hidden />
      </button>
      <div id={bodyId} className="admin-accordion-body" aria-hidden={!open} aria-labelledby={headingId}>
        <div className="admin-accordion-inner">{mounted ? children : null}</div>
      </div>
    </section>
  );
}

function ReportEvidencePanel({ personId, date }: { personId: string; date: string }) {
  const evidence = useQuery<EvidenceResponse>({
    queryKey: adminKeys.reportEvidence(personId, date),
    queryFn: () => fetchReportEvidence(personId, date),
    select: normalizeEvidence,
    enabled: !!personId,
    staleTime: ADMIN_DETAIL_STALE_MS,
  });
  const [preview, setPreview] = useState<{ summaryId: string; title: string } | null>(null);
  const rows = evidence.data?.evidence ?? [];
  const visible = rows.slice(0, 12);
  return (
    <div className="admin-drawer-panel">
      <div className="admin-drawer-panel-head">
        <span>{evidence.isLoading ? "Loading evidence…" : `${rows.length} record${rows.length === 1 ? "" : "s"}`}</span>
      </div>
      {evidence.isLoading ? <Skeleton className="h-20" /> : rows.length ? (
        <ul className="admin-evidence-list">
          {visible.map((row) => {
            const shot = screenshotOf(row);
            return (
              <li key={row.id} className="admin-evidence-item">
                {shot ? (
                  <button type="button" className="admin-evidence-thumb" aria-label={`Expand evidence image for ${row.title}`} onClick={() => setPreview(shot)}>
                    <ScreenshotImage
                      summaryId={shot.summaryId}
                      size="thumb"
                      alt={`Retained Worktivity frame for ${row.title}`}
                      unavailableLabel="Private"
                    />
                  </button>
                ) : (
                  <span className="admin-evidence-thumb is-empty">
                    {row.source === "loom" ? <Video size={15} aria-hidden /> : row.source === "github" ? <Github size={15} aria-hidden /> : row.source === "nifty" ? <FileText size={15} aria-hidden /> : <Camera size={15} aria-hidden />}
                  </span>
                )}
                <span className="admin-evidence-copy">
                  <strong>{row.title}</strong>
                  <small>{row.summary}</small>
                  <span className="admin-evidence-meta">
                    <Pill tone={row.source === "worktivity" ? "observed" : "neutral"}>{statusLabel(row.source)}</Pill>
                    {row.url ? <a href={row.url} target="_blank" rel="noreferrer">Open</a> : null}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="admin-empty-note">No evidence rows were recorded for this day.</p>}
      {preview ? <EvidencePreviewDialog preview={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function ReportRecapsPanel({ personId, date, onOpenRecaps }: { personId: string; date: string; onOpenRecaps?: () => void }) {
  const intervals = useQuery({
    queryKey: adminKeys.reportIntervals(personId, date),
    queryFn: () => fetchReportIntervals(personId, date),
    select: normalizeIntervals,
    enabled: !!personId,
    staleTime: ADMIN_DETAIL_STALE_MS,
  });
  const rows = intervals.data?.intervals ?? [];
  const visible = rows.slice(0, 8);
  return (
    <div className="admin-drawer-panel">
      <div className="admin-drawer-panel-head">
        <span>{intervals.isLoading ? "Loading recaps…" : `${rows.length} recap${rows.length === 1 ? "" : "s"}`}</span>
        {onOpenRecaps ? (
          <AdminButton variant="secondary" icon={ArrowUpRight} onClick={onOpenRecaps}>See all recaps</AdminButton>
        ) : null}
      </div>
      {intervals.isLoading ? <Skeleton className="h-20" /> : rows.length ? (
        <div className="admin-recap-list">
          {visible.map((interval) => (
            <article key={interval.id} className="admin-recap-card">
              <header><strong>{interval.headline ?? "Interval"}</strong><span>{interval.label}</span></header>
              {interval.detail ? <p>{interval.detail}</p> : null}
              <div className="admin-recap-meta">
                <Pill tone={interval.reviewStatus === "confirmed" ? "ok" : interval.reviewStatus === "amended" ? "info" : "neutral"}>
                  {statusLabel(interval.reviewStatus)}
                </Pill>
                <span>{interval.evidenceCount} evidence</span>
              </div>
            </article>
          ))}
        </div>
      ) : <p className="admin-empty-note">No interval recaps were recorded for this day.</p>}
    </div>
  );
}

function ReportBody({ report, onOpenEvidence, onOpenRecaps }: { report: WorkOsReportRow; onOpenEvidence?: (personId: string) => void; onOpenRecaps?: () => void }) {
  const document = parseEodMarkdown(report.submitted_markdown ?? report.markdown);
  const facts = eodMetricFacts(report.metrics);

  const renderEodSection = (section: (typeof document.sections)[number]) => (
    <div key={section.heading} className="admin-report-section">
      <h3 className={/activity context/i.test(section.heading) ? "is-observed" : undefined}>
        <EodSectionIcon heading={section.heading} size={12} />
        <span>{section.heading}</span>
      </h3>
      <ul>
        {section.lines.map((line, index) => (
          <li key={`${section.heading}-${index}`} className={line.kind === "note" ? "note" : undefined}>
            {line.kind === "bullet" ? <span className="admin-dot ok" aria-hidden /> : null}
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="admin-grid admin-drawer-grid">
      <div className="admin-chips">
        <Pill tone={reportTone(report.status)}>{statusLabel(report.status)}</Pill>
        {facts.map((fact) => <Pill key={fact.label}>{fact.label}: {fact.value}</Pill>)}
        {report.manager_notes ? <Pill tone="info">Notes on record</Pill> : null}
      </div>
      {report.person_id && onOpenEvidence ? (
        <div className="admin-drawer-quick">
          <AdminButton variant="secondary" icon={ArrowUpRight} onClick={() => onOpenEvidence(report.person_id!)}>
            More Evidence
          </AdminButton>
        </div>
      ) : null}

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
        {document.sections.map(renderEodSection)}
        {document.appendix.length ? (
          <details className="admin-report-appendix">
            <summary>
              Full record · {document.appendix.reduce((count, section) => count + section.lines.filter((line) => line.kind === "bullet").length, 0)} rows
            </summary>
            <div className="admin-report-appendix-body">{document.appendix.map(renderEodSection)}</div>
          </details>
        ) : null}
        {document.closing ? <p className="admin-quiet">{document.closing}</p> : null}
      </section>

      <section className="admin-block admin-drawer-accordions">
        <AdminAccordion title="Sourced evidence" icon={Camera}>
          <ReportEvidencePanel personId={report.person_id ?? ""} date={report.report_date} />
        </AdminAccordion>
        <AdminAccordion title="Interval recaps" icon={Activity}>
          <ReportRecapsPanel personId={report.person_id ?? ""} date={report.report_date} onOpenRecaps={onOpenRecaps} />
        </AdminAccordion>
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
