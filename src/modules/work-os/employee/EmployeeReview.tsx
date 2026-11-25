"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, X } from "lucide-react";
import EodReportDocument from "./EodReportDocument";
import EmployeeEodEvidence from "./EmployeeEodEvidence";
import EmployeeEodComposer from "./EmployeeEodComposer";
import EodStructuredView from "@/modules/work-os/eod-structured-view";
import { CheckedMoment } from "./CheckedMoment";
import { useEmployeeDay, useOutstandingEods } from "./useEmployeeDay";
import { useNow } from "./useNow";
import { HttpError, fetchJson, calendarDateLabel, longDateLabel, requestId, type AnyRow, type EmployeeDayResponse, type OutstandingEodDay } from "./model";
import { normalizeEodStructuredReport } from "@/modules/work-os/eod-structured";
import {
  EOD_SHIFT_OPEN_LINK_LABEL,
  EOD_SHIFT_OPEN_PREFIX,
  EOD_SHIFT_OPEN_SUFFIX,
  eodDraftBlocked,
  eodDraftWindowOpen,
} from "@/lib/work-os-shift-gate";
import { SyncChip } from "./ui";
import styles from "./EmployeeReview.module.css";

const EOD_STATUS_META: Record<OutstandingEodDay["status"], { label: string; tone: "open" | "overdue" | "error" }> = {
  no_draft: { label: "Needs draft", tone: "overdue" },
  draft_unsubmitted: { label: "Draft not submitted", tone: "open" },
  changes_requested: { label: "Changes requested", tone: "error" },
};

function observedLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours}h ${String(rest).padStart(2, "0")}m observed` : `${rest}m observed`;
}

function outstandingRowMeta(day: OutstandingEodDay) {
  const outcomes = day.completedTasks > 0 ? `${day.completedTasks} task outcome${day.completedTasks === 1 ? "" : "s"}` : null;
  return [observedLabel(day.observedMinutes), outcomes].filter(Boolean).join(" · ");
}

function eodStatusLabel(value: string) {
  return value ? value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase()) : "Not drafted";
}

function proposalSummary(proposal: AnyRow) {
  const change = proposal.proposed_change ?? {};
  return change.name || change.title || change.summary || change.progress || change.description || proposal.input_text;
}

export default function EmployeeReview() {
  const { day, refresh, sync, syncing } = useEmployeeDay();
  const outstanding = useOutstandingEods();
  const now = useNow();
  const [selectedDate, setSelectedDate] = useState("");
  /** The confirmation names the day actually submitted, not whichever day is
   * selected when a late response lands. */
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ date: string; at: string | null } | null>(null);
  const [prepareNote, setPrepareNote] = useState<string | null>(null);
  const preparedDates = useRef(new Set<string>());

  useEffect(() => {
    if (day.data?.shiftDate) setSelectedDate((current) => current || day.data!.shiftDate);
  }, [day.data?.shiftDate]);

  const historical = !!selectedDate && !!day.data?.shiftDate && selectedDate !== day.data.shiftDate;
  const selectedDay = useQuery<EmployeeDayResponse>({
    queryKey: ["work-os", "my-day", selectedDate],
    queryFn: () => fetchJson(`/api/work-os/me/day?date=${encodeURIComponent(selectedDate)}`),
    enabled: historical,
    staleTime: 2 * 60_000,
  });

  const eodDay = historical ? selectedDay.data ?? null : day.data ?? null;
  const eodReport = eodDay?.report ?? null;
  const structured = useMemo(
    () => eodReport ? normalizeEodStructuredReport(eodReport.structured_report) : null,
    [eodReport],
  );
  const scheduledEndsAt = eodDay?.dayShift?.endsAt ?? null;
  const shiftOpen = !historical && eodDraftBlocked({
    session: eodDay?.session ?? null,
    attendance: eodDay?.attendance ?? null,
    scheduledEndsAt,
    now,
  });
  const shiftBlocked = shiftOpen || (
    refusal?.date === selectedDate
    && refusal.at === (eodDay?.at ?? null)
    && !eodDraftWindowOpen({ session: eodDay?.session ?? null, scheduledEndsAt, now })
  );

  const prepare = useMutation({
    mutationFn: (date: string) => fetchJson<{ report: AnyRow }>("/api/work-os/me/eod/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    }),
    onSuccess: () => {
      setPrepareNote(null);
      void refresh();
      if (historical) void selectedDay.refetch();
    },
    onError: (error, date) => {
      if (error instanceof HttpError && error.status === 409) {
        preparedDates.current.delete(date);
        if (date === selectedDate) setRefusal({ date, at: eodDay?.at ?? null });
        return;
      }
      setPrepareNote(error instanceof Error ? error.message : "Your report could not be prepared.");
    },
  });

  // A page that opens before the scheduler has prepared the day asks once for
  // the same server-side analysis. The employee never sees a "Draft" button.
  useEffect(() => {
    const date = eodDay?.shiftDate ?? (historical ? selectedDate : "");
    if (!date || eodReport || shiftBlocked || prepare.isPending) return;
    if (historical && selectedDay.isLoading) return;
    if (historical && selectedDay.error && !selectedDay.data) return;
    if (preparedDates.current.has(date)) return;
    preparedDates.current.add(date);
    prepare.mutate(date);
  }, [
    eodDay?.shiftDate,
    eodReport,
    shiftBlocked,
    historical,
    selectedDay.isLoading,
    selectedDay.error,
    selectedDay.data,
    selectedDate,
    prepare.isPending,
    prepare.mutate,
  ]);

  // A different day starts from its own preparation and gate state.
  useEffect(() => {
    setRefusal(null);
    setPrepareNote(null);
    prepare.reset();
  }, [selectedDate, prepare.reset]);

  const review = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "accept" | "reject" }) => {
      const row = await fetchJson<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({ decision }),
      });
      const expected = decision === "accept" ? "applied" : "rejected";
      if (row?.outcome && row.outcome !== expected) {
        throw new Error(row.failure_reason?.trim()
          || (row.outcome === "applying" ? "This action is still being applied. Recheck in a moment." : `This action could not be ${decision === "accept" ? "approved" : "rejected"}.`));
      }
      return row;
    },
    onSuccess: () => void refresh(),
  });

  const proposals = day.data?.proposals ?? [];
  const outstandingDays = outstanding.data?.days ?? [];
  const error = day.error || selectedDay.error || outstanding.error || review.error;
  const status = String(eodReport?.status || "");
  const editorLocked = status === "pending_review" || status === "approved";
  const statusLabel = eodReport ? eodStatusLabel(status) : prepare.isPending ? "Preparing" : "Not drafted";
  const statusClass = status === "approved" ? styles.statusApproved : status === "rejected" ? styles.statusRejected : status === "pending_review" ? styles.statusSubmitted : "";

  const shiftOpenPrompt = (prefix: string, suffix: string) => (
    <p className={styles.recordNote}>
      {prefix}{" "}
      <Link href="/work-os/today" className={styles.inlineLink}>{EOD_SHIFT_OPEN_LINK_LABEL}</Link>
      {suffix}
    </p>
  );

  const retryPrepare = () => {
    const date = eodDay?.shiftDate ?? (historical ? selectedDate : "");
    if (!date) return;
    preparedDates.current.delete(date);
    setPrepareNote(null);
    prepare.mutate(date);
  };

  const submittedView = eodReport ? (
    <div className="grid gap-4">
      <div className={styles.notice} role="status">
        {status === "approved" ? "Approved." : "Submitted — waiting for review."}
      </div>
      {structured && structured.summary ? (
        <EodStructuredView report={structured} variant="employee" />
      ) : null}
      <details className={styles.fullRecord}>
        <summary>Full recorded day</summary>
        <div>
          <EodReportDocument
            markdown={String(eodReport.submitted_markdown ?? eodReport.markdown ?? "")}
            editing={false}
            locked
            onChange={() => undefined}
          />
        </div>
      </details>
    </div>
  ) : null;

  const eodPanel = (() => {
    if (confirmedDate === selectedDate) {
      return (
        <div className={styles.confirm} role="status">
          <CheckedMoment className="!h-[168px] !w-[168px]" />
          <strong className={styles.confirmTitle}>EOD submitted</strong>
          <p className={styles.confirmCopy}>
            {historical ? `Your report for ${calendarDateLabel(selectedDate)} is with your manager.` : "Your report is with your manager. You are done for today."}
          </p>
          <button type="button" className={styles.secondaryButton} onClick={() => setConfirmedDate(null)}>
            <ArrowLeft size={13} /> All EODs
          </button>
        </div>
      );
    }
    if (historical && selectedDay.isLoading && !selectedDay.data) {
      return (
        <div className="grid gap-3" aria-busy="true">
          <div className={styles.skeleton} style={{ width: "40%" }} />
          <div className={styles.skeletonBlock} style={{ height: 300 }} />
        </div>
      );
    }
    if (historical && selectedDay.error && !selectedDay.data) {
      return (
        <div className={styles.empty}>
          <strong className={styles.emptyTitle}>That day could not be loaded</strong>
          <p className={styles.emptyCopy}>{(selectedDay.error as Error).message}</p>
          <button type="button" className={styles.secondaryButton} onClick={() => void selectedDay.refetch()}>Try again</button>
        </div>
      );
    }
    if (eodReport) {
      if (editorLocked) return submittedView;
      return (
        <div className="grid gap-0">
          {shiftBlocked ? <div className={`${styles.notice} mb-4`}>{shiftOpenPrompt(EOD_SHIFT_OPEN_PREFIX, EOD_SHIFT_OPEN_SUFFIX.web)}</div> : null}
          <EmployeeEodComposer
            key={`${String(eodReport.id)}:${status}`}
            reportId={String(eodReport.id)}
            reportDate={String(eodReport.report_date ?? eodDay?.shiftDate ?? selectedDate)}
            initial={structured ?? normalizeEodStructuredReport({})}
            legacyMarkdown={String(eodReport.markdown ?? "")}
            status={status === "rejected" ? "rejected" : "draft"}
            onSubmitted={(submitted) => {
              setRefusal(null);
              void refresh();
              if (historical) void selectedDay.refetch();
              setConfirmedDate(String(submitted?.report_date ?? selectedDate));
            }}
          />
        </div>
      );
    }
    if (shiftBlocked) {
      return (
        <div className={styles.record}>
          {shiftOpenPrompt(EOD_SHIFT_OPEN_PREFIX, EOD_SHIFT_OPEN_SUFFIX.web)}
          <p className={styles.recordNote}>
            Your report is prepared from the recorded day when the EOD window opens. Nothing is filed until you submit it.
          </p>
        </div>
      );
    }
    if (prepareNote) {
      return (
        <div className={styles.empty}>
          <strong className={styles.emptyTitle}>Your report could not be prepared</strong>
          <p className={styles.emptyCopy}>{prepareNote}</p>
          <button type="button" className={styles.secondaryButton} onClick={retryPrepare}>Try again</button>
        </div>
      );
    }
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="Preparing your report">
        <div className={styles.skeleton} style={{ width: "34%" }} />
        <div className={styles.skeletonBlock} style={{ height: 132 }} />
        <div className={styles.skeletonBlock} style={{ height: 280 }} />
      </div>
    );
  })();

  return (
    <div className={styles.page} id="employee-eod-panel">
      <header className={`${styles.masthead} ${styles.reveal}`} style={{ "--delay": "0ms" } as CSSProperties}>
        <div className={styles.metaRow}><span>{selectedDate ? longDateLabel(selectedDate) : "Loading your review"}</span></div>
        <div className={styles.titleRow}>
          <h1>EOD review</h1>
          <p className={styles.titleMeta}>
            {historical ? `Drafting for ${calendarDateLabel(selectedDate)} · historical records are read-only outside the report.` : "Your end-of-day report, proposed changes, and recorded evidence."}
          </p>
          <div className={styles.utilities}>
            <input
              type="date"
              value={selectedDate}
              max={day.data?.shiftDate ?? undefined}
              onChange={(event) => setSelectedDate(event.target.value)}
              aria-label="Report date"
              className={styles.dateField}
            />
            {historical ? (
              <button type="button" className={styles.secondaryButton} onClick={() => setSelectedDate(day.data?.shiftDate ?? "")}>Back to today</button>
            ) : null}
            <SyncChip compact sync={day.data?.niftySync} syncing={syncing || day.isFetching || selectedDay.isFetching} onSync={() => sync.mutate()} />
          </div>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeErr}`}>{(error as Error).message}</div> : null}

      <div className={styles.grid}>
        <div className={styles.main}>
          <section className={`${styles.surface} ${styles.reveal}`} id="employee-eod-editor" style={{ "--delay": "80ms" } as CSSProperties} aria-labelledby="review-eod-title">
            <div className={styles.surfaceHead}>
              <div>
                <span className={styles.eyebrow}>Review</span>
                <h2 className={styles.surfaceTitle} id="review-eod-title">
                  {historical ? `Report for ${calendarDateLabel(selectedDate)}` : "End of day"}
                </h2>
                <p className={styles.surfaceMeta}>
                  {historical ? "The recorded day stays read-only outside the report." : "Written by you, opened by Otto."}
                </p>
              </div>
              <span className={`${styles.status} ${statusClass}`}>{statusLabel}</span>
            </div>
            <div className={styles.surfaceBody}>{eodPanel}</div>
          </section>

          {!historical && proposals.length ? (
            <section className={`${styles.section} ${styles.reveal}`} style={{ "--delay": "160ms" } as CSSProperties} aria-labelledby="review-proposals-title">
              <header className={styles.sectionHead}>
                <div>
                  <h2 id="review-proposals-title">Proposed changes</h2>
                  <p className={styles.sectionMeta}>Otto proposed these from your updates. Nothing is applied until you approve it.</p>
                </div>
                <span className={styles.sectionCount}>{proposals.length}</span>
              </header>
              <ul className={styles.rows}>
                {proposals.map((proposal) => (
                  <li key={proposal.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowKicker}>{String(proposal.operation ?? "").replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase())}</span>
                      <span className={styles.rowTitle}>{proposal.task?.title || proposal.before_state?.title || proposalSummary(proposal)}</span>
                      {proposal.task?.title || proposal.before_state?.title ? <p className={styles.rowCopy}>{proposalSummary(proposal)}</p> : null}
                      {proposal.failure_reason ? <p className={styles.rowFailure}>{proposal.failure_reason}</p> : null}
                    </div>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.secondaryButton} aria-label="Reject proposal" onClick={() => review.mutate({ id: proposal.id, decision: "reject" })} disabled={review.isPending}>
                        <X size={14} /> Reject
                      </button>
                      {proposal.status !== "stale" ? (
                        <button type="button" className={styles.primaryButton} aria-label="Accept proposal" onClick={() => review.mutate({ id: proposal.id, decision: "accept" })} disabled={review.isPending}>
                          <Check size={14} /> Approve
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <EmployeeEodEvidence
            date={selectedDate}
            timezone={day.data?.shift?.timezone}
            enabled={day.data?.access?.featureFlags?.screenshot_summaries === true}
          />
        </div>

        <aside className={`${styles.side} ${styles.reveal}`} style={{ "--delay": "280ms" } as CSSProperties}>
          <section className={styles.rail} aria-labelledby="review-outstanding-title">
            <header className={styles.railHead}>
              <h2 id="review-outstanding-title">Outstanding EODs</h2>
              <span className={styles.railCount}>{outstanding.data?.count ?? 0}</span>
            </header>
            <p className={styles.railCopy}>
              {outstanding.data?.count ? `${outstanding.data.count} past day${outstanding.data.count === 1 ? "" : "s"} without a submitted report.` : "Every past workday has a report."}
            </p>
            {outstanding.isLoading && !outstanding.data ? (
              <div className="grid gap-2 py-3" aria-busy="true">
                <div className={styles.skeleton} style={{ width: "60%" }} />
                <div className={styles.skeleton} style={{ width: "80%" }} />
                <div className={styles.skeleton} style={{ width: "50%" }} />
              </div>
            ) : outstanding.error && !outstandingDays.length ? (
              <div className={styles.empty}>
                <strong className={styles.emptyTitle}>Could not load outstanding EODs</strong>
                <p className={styles.emptyCopy}>{(outstanding.error as Error).message}</p>
                <button type="button" className={styles.secondaryButton} onClick={() => void outstanding.refetch()}>Try again</button>
              </div>
            ) : outstandingDays.length ? (
              <ul className={styles.rows}>
                {outstandingDays.map((outstandingDay) => {
                  const meta = EOD_STATUS_META[outstandingDay.status];
                  return (
                    <li key={outstandingDay.date}>
                      <button
                        type="button"
                        className={styles.dayRow}
                        onClick={() => {
                          setSelectedDate(outstandingDay.date);
                          window.requestAnimationFrame(() => document.getElementById("employee-eod-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                        }}
                      >
                        <span className="min-w-0">
                          <span className={styles.dayDate}>{calendarDateLabel(outstandingDay.date)}</span>
                          <span className={styles.dayMeta}>{outstandingRowMeta(outstandingDay) || "Recorded workday"}</span>
                        </span>
                        <span className={styles.dayStatus} style={{ color: meta.tone === "error" ? "var(--status-error)" : meta.tone === "open" ? "var(--text-tertiary)" : "var(--status-warn)" }}>{meta.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className={styles.empty}>
                <strong className={styles.emptyTitle}>You’re caught up</strong>
                <p className={styles.emptyCopy}>No past workday is missing a submitted EOD.</p>
              </div>
            )}
          </section>

          {historical ? (
            <p className={styles.historical}>Historical workspace: tasks and evidence are read-only, and the report is prepared against {calendarDateLabel(selectedDate)}.</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
