"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, FileCheck2, Send, Sparkles, Video, Wand2, X } from "lucide-react";
import EmployeeEodEvidence from "./EmployeeEodEvidence";
import { CheckedMoment } from "./CheckedMoment";
import { useEmployeeDay, useOutstandingEods } from "./useEmployeeDay";
import { useNow } from "./useNow";
import { HttpError, fetchJson, calendarDateLabel, longDateLabel, requestId, type AnyRow, type EmployeeDayResponse, type OutstandingEodDay } from "./model";
import { assistantDraftFallbackNotice, assistantDraftNotice, prepareOneScreenshotRound, stripBottleneckSection, extractBottleneckSection, restoreBottleneckSection, type AssistantEodDraftResponse } from "./eod";
import {
  EOD_SHIFT_OPEN_LINK_LABEL,
  EOD_SHIFT_OPEN_PREFIX,
  EOD_SHIFT_OPEN_REASON,
  EOD_SHIFT_OPEN_REBUILD_PREFIX,
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
  const [reportMarkdown, setReportMarkdown] = useState("");
  /** The EOD page keeps the moment after a submission: the confirmation stays
   * until the employee returns to the EOD list. */
  const [eodConfirmation, setEodConfirmation] = useState(false);
  // The confirmation names the day that was submitted; changing the day must
  // never leave it looking like that report was just filed.
  useEffect(() => { setEodConfirmation(false); }, [selectedDate]);
  const [draftSource, setDraftSource] = useState<"ai" | "deterministic" | null>(null);
  const [eodNotice, setEodNotice] = useState<{ tone: "info" | "warn" | "err"; text: string } | null>(null);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [loomOpen, setLoomOpen] = useState(false);
  const [loomUrl, setLoomUrl] = useState("");
  const [loomTranscript, setLoomTranscript] = useState("");

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
  /* Today's report opens in the final ten minutes before its scheduled
     clock-out, so the employee can finish before clocking out. The server
     enforces the same window; this is the prompt that explains the wait before
     the employee reaches for the button. A refusal is remembered for the day it
     happened and only while that day's payload is the one the server judged, so
     a fresh payload supersedes it — clocking out, or the window opening, brings
     the draft action back. */
  const [refusal, setRefusal] = useState<{ date: string; at: string | null } | null>(null);
  useEffect(() => { setRefusal(null); }, [selectedDate]);
  const scheduledEndsAt = eodDay?.dayShift?.endsAt ?? null;
  const shiftOpen = !historical && eodDraftBlocked({
    session: eodDay?.session ?? null,
    attendance: eodDay?.attendance ?? null,
    scheduledEndsAt,
    now,
  });
  const shiftBlocked = shiftOpen || (refusal?.date === selectedDate && refusal.at === (eodDay?.at ?? null) && !eodDraftWindowOpen({ session: eodDay?.session ?? null, scheduledEndsAt, now }));
  /* The report date the editor is currently showing; an assistant response for
     another day must never alter the active editor. */
  const activeReportDateRef = useRef<string>("");
  // Kept current at commit, not after paint: a deferred assistant response must
  // never pass the guard against the date the editor has already left.
  useLayoutEffect(() => { activeReportDateRef.current = eodDay?.shiftDate ?? ""; }, [eodDay?.shiftDate]);

  type AssistantDraftMode = "draft" | "redraft" | "refine" | "loom";
  const assistantDraft = useMutation({
    mutationFn: (variables: { mode: AssistantDraftMode; date: string; draft?: string; bottleneck?: string; feedback?: string; loom?: { url: string; transcript?: string } }) =>
      fetchJson<AssistantEodDraftResponse>("/api/work-os/me/eod/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: variables.date,
          ...(variables.draft !== undefined ? { draft: variables.draft } : {}),
          ...(variables.feedback ? { feedback: variables.feedback } : {}),
          ...(variables.loom ? { loom: variables.loom } : {}),
        }),
      }),
    onSuccess: (result, variables) => {
      // A response for a day the editor has left is dropped, not applied.
      if (variables.date !== activeReportDateRef.current) return;
      if (result.markdown) setReportMarkdown(variables.mode === "refine" ? restoreBottleneckSection(result.markdown, variables.bottleneck ?? "") : result.markdown);
      setDraftSource("ai");
      if (variables.mode === "refine") setEodNotice({ tone: "info", text: "The draft was refined from your feedback." });
      else if (variables.mode === "loom") setEodNotice({ tone: "info", text: "Draft rebuilt from your Loom recording. Review every line." });
      else if (result.clockedOut) setEodNotice({ tone: "info", text: "You were clocked out automatically and the assistant drafted your EOD. Review every line." });
      else setEodNotice({ tone: "info", text: assistantDraftNotice(result) });
      void refresh();
    },
    onError: (error, variables) => {
      if (variables.date !== activeReportDateRef.current) return;
      const gated = error instanceof HttpError && error.status === 409;
      // The server refuses a draft for a day that has not ended; the prompt
      // explains it instead of a bare failure.
      if (gated && error instanceof HttpError && error.reason === EOD_SHIFT_OPEN_REASON) {
        setRefusal({ date: variables.date, at: eodDay?.at ?? null });
        return;
      }
      const message = error instanceof Error ? error.message : "The assistant draft failed.";
      if (variables.mode === "refine") {
        setEodNotice({ tone: gated ? "warn" : "err", text: `Your feedback was not applied. Your draft is unchanged.${gated ? ` ${message}` : ""}` });
        return;
      }
      if (variables.mode === "draft") {
        setEodNotice({ tone: gated ? "warn" : "info", text: assistantDraftFallbackNotice(gated, message) });
        return;
      }
      setEodNotice({ tone: gated ? "warn" : "err", text: `${message} Your draft is unchanged.` });
    },
  });

  /* The day a draft attempt was made, so a late refusal never lands on the
     day the employee has since opened. */
  const attemptedRef = useRef<{ date: string; at: string | null }>({ date: "", at: null });

  const draftEod = useMutation({
    mutationFn: async () => {
      if (!eodDay?.shiftDate) throw new Error("Load the day before drafting its EOD");
      const date = eodDay.shiftDate;
      attemptedRef.current = { date, at: eodDay.at ?? null };
      // Analyze one bounded batch of waiting frames first so the assistant
      // draft reads the freshest record (the companion runs its own rounds).
      if (day.data?.access?.featureFlags?.screenshot_summaries === true) await prepareOneScreenshotRound(date);
      const created = await fetchJson<{ report: AnyRow }>("/api/work-os/reports/eod", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({ date }),
      });
      // The created record lands in the editor only while that day is active.
      if (date === activeReportDateRef.current) {
        setEodNotice(null);
        setDraftSource("deterministic");
        setReportMarkdown(String(created.report?.markdown ?? ""));
      }
      return { created, date };
    },
    onError: (error) => {
      // A shift that is still open refuses the draft; the prompt replaces it.
      if (error instanceof HttpError && error.status === 409 && error.reason === EOD_SHIFT_OPEN_REASON) {
        setRefusal(attemptedRef.current);
      }
    },
    onSuccess: (result) => {
      void refresh();
      if (result.date !== activeReportDateRef.current) return;
      // The assistant draft is the default: the standard record stays as the
      // fallback when the assistant is unavailable or the day is gated.
      assistantDraft.mutate({ mode: "draft", date: result.date });
    },
  });

  const redraftEod = useMutation({
    mutationFn: async () => {
      const date = eodDay?.shiftDate ?? "";
      if (!date) throw new Error("Load the day before redrafting its EOD");
      if (day.data?.access?.featureFlags?.screenshot_summaries === true) await prepareOneScreenshotRound(date);
      return assistantDraft.mutateAsync({ mode: "redraft", date });
    },
  });

  const appliedReportRef = useRef<string | null>(null);

  /* A different review day starts from its own report state. */
  useEffect(() => {
    appliedReportRef.current = null;
    setDraftSource(null);
    setEodNotice(null);
  }, [selectedDate]);

  /* Adopt the server's stored markdown when the report itself changes (a new
     report or a status transition). The key is claimed even when adoption is
     skipped because an assistant draft is in flight: the server stores the
     deterministic copy until the report is submitted, so adopting it once the
     mutation settles would overwrite the assistant's markdown. Skipping is
     safe — the draft mutation already applied the created record, and the
     status key changes again on the next real transition. */
  useEffect(() => {
    if (!eodReport) return;
    const key = `${eodReport.id}:${eodReport.status}`;
    if (appliedReportRef.current === key) return;
    appliedReportRef.current = key;
    if (assistantDraft.isPending) return;
    setReportMarkdown(eodReport.markdown ?? "");
  }, [eodReport?.id, eodReport?.status, eodReport?.markdown, assistantDraft.isPending]);

  const submitEod = useMutation({
    mutationFn: () => {
      if (!eodReport?.id) throw new Error("Draft the EOD report before submitting it");
      return fetchJson(`/api/work-os/reports/${eodReport.id}/submit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({ markdown: reportMarkdown }),
      });
    },
    onSuccess: () => { setEodConfirmation(true); void refresh(); },
  });

  const review = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "accept" | "reject" }) => {
      const row = await fetchJson<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({ decision }),
      });
      // A 200 is not proof the decision landed: the proposal may be stale,
      // already decided in another window, or still applying.
      const expected = decision === "accept" ? "applied" : "rejected";
      if (row?.outcome && row.outcome !== expected) {
        throw new Error(row.failure_reason?.trim()
          || (row.outcome === "applying" ? "This action is still being applied. Recheck in a moment." : `This action could not be ${decision === "accept" ? "approved" : "rejected"}.`));
      }
      return row;
    },
    onSuccess: () => void refresh(),
  });

  const disputeEvidence = useMutation({
    mutationFn: (eventId: string) => fetchJson(`/api/work-os/evidence/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correction_status: "disputed", reason: "Employee disputed this evidence from Review." }),
    }),
    onSuccess: () => void refresh(),
  });

  const proposals = day.data?.proposals ?? [];
  const evidence = eodDay?.evidence ?? [];
  const outstandingDays = outstanding.data?.days ?? [];
  /* A refusal for an open shift is explained by the prompt, not by a raw
     error banner. */
  const shiftRefusal = draftEod.error instanceof HttpError && draftEod.error.status === 409 && draftEod.error.reason === EOD_SHIFT_OPEN_REASON;
  const error = day.error || selectedDay.error || outstanding.error || (shiftRefusal ? null : draftEod.error) || submitEod.error || review.error || disputeEvidence.error;
  const status = String(eodReport?.status || "");
  const editorLocked = status === "pending_review" || status === "approved";
  const submitLabel = status === "pending_review" ? "Submitted for review" : status === "approved" ? "Approved" : "Submit for review";

  /* The prompt for a shift that has not ended. The clock-out reads as inline
     text, underlined, and behaves like the action it names: it takes the
     employee to the dashboard, where the Windows Companion closes the
     shift. */
  const shiftOpenPrompt = (prefix: string, suffix: string) => (
    <p className={styles.recordNote}>
      {prefix}{" "}
      <Link href="/work-os/today" className={styles.inlineLink}>{EOD_SHIFT_OPEN_LINK_LABEL}</Link>
      {suffix}
    </p>
  );

  const eodPanel = (() => {
    if (eodConfirmation) {
      return (
        <div className={styles.confirm} role="status">
          <CheckedMoment className="!h-[168px] !w-[168px]" />
          <strong className={styles.confirmTitle}>EOD submitted</strong>
          <p className={styles.confirmCopy}>
            {historical ? `Your report for ${calendarDateLabel(selectedDate)} is with your manager.` : "Your report is with your manager. You are done for today."}
          </p>
          <button type="button" className={styles.secondaryButton} onClick={() => setEodConfirmation(false)}>
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
      return (
        <div className={styles.editorWrap}>
          {eodNotice ? (
            <div className={`${styles.notice} ${eodNotice.tone === "warn" ? styles.noticeWarn : eodNotice.tone === "err" ? styles.noticeErr : ""}`}>
              {eodNotice.text}
            </div>
          ) : null}
          {shiftBlocked && !editorLocked ? <div className={styles.notice}>{shiftOpenPrompt(EOD_SHIFT_OPEN_REBUILD_PREFIX, EOD_SHIFT_OPEN_SUFFIX.webRebuild)}</div> : null}
          <textarea
            value={reportMarkdown}
            onChange={(event) => setReportMarkdown(event.target.value)}
            rows={16}
            className={styles.editor}
            disabled={editorLocked}
            aria-label="EOD report draft"
          />

          {!editorLocked ? (
            <div className={styles.disclosure}>
              <div className={styles.disclosureHead}>
                <span className={styles.disclosureLabel}>Ask the assistant to adjust this draft</span>
                <button type="button" className={styles.disclosureToggle} onClick={() => { setRefineOpen((value) => !value); setEodNotice(null); }}>
                  {refineOpen ? "Close" : "Refine draft"}
                </button>
              </div>
              {refineOpen ? (
                <div className={`${styles.disclosureBody} ${styles.inlineRow}`}>
                  <input
                    value={refineInput}
                    onChange={(event) => setRefineInput(event.target.value)}
                    placeholder="e.g. Lead with the settlement outcome and drop the stale ticket."
                    className={`${styles.input} ${styles.grow}`}
                    aria-label="EOD refinement request"
                  />
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={!refineInput.trim() || assistantDraft.isPending}
                    onClick={() => assistantDraft.mutate({ mode: "refine", date: eodDay?.shiftDate ?? "", draft: stripBottleneckSection(reportMarkdown), bottleneck: extractBottleneckSection(reportMarkdown), feedback: refineInput.trim() })}
                  >
                    <Wand2 size={13} /> {assistantDraft.isPending ? "Refining…" : "Apply refinement"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {!editorLocked && day.data?.access?.featureFlags?.loom_updates === true ? (
            <div className={styles.disclosure}>
              <div className={styles.disclosureHead}>
                <span className={styles.disclosureLabel}>Recorded a Loom for this day?</span>
                <button type="button" className={styles.disclosureToggle} onClick={() => { setLoomOpen((value) => !value); setEodNotice(null); }}>
                  {loomOpen ? "Close" : "Analyze a Loom"}
                </button>
              </div>
              {loomOpen ? (
                <div className={styles.disclosureBody}>
                  <input
                    value={loomUrl}
                    onChange={(event) => setLoomUrl(event.target.value)}
                    placeholder="https://www.loom.com/share/…"
                    className={styles.input}
                    aria-label="Loom share link"
                  />
                  <textarea
                    value={loomTranscript}
                    onChange={(event) => setLoomTranscript(event.target.value)}
                    rows={3}
                    maxLength={50000}
                    placeholder="Paste the transcript when Loom has none (optional)."
                    className={styles.textarea}
                    aria-label="Loom transcript"
                  />
                  <div className={styles.inlineRow}>
                    <p className={`${styles.recordNote} ${styles.grow}`}>Draft context only — it never files an update, and a recording from another day is refused.</p>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={!loomUrl.trim() || assistantDraft.isPending}
                      onClick={() => assistantDraft.mutate({ mode: "loom", date: eodDay?.shiftDate ?? "", loom: { url: loomUrl.trim(), transcript: loomTranscript.trim() || undefined } })}
                    >
                      <Video size={13} /> {assistantDraft.isPending ? "Analyzing…" : "Rebuild draft"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={styles.editorFoot}>
            <p className={styles.editorNote}>
              {status === "pending_review" ? "Submitted — waiting for review."
                : status === "approved" ? "Approved."
                  : status === "rejected" ? "Changes were requested. Update the report and resubmit it."
                    : "Nothing is filed until you submit."}
              {draftSource ? ` · ${draftSource === "ai" ? "Assistant draft" : "Standard draft"}` : ""}
            </p>
            <div className={styles.editorActions}>
              {!editorLocked && !shiftBlocked ? (
                <button type="button" className={styles.secondaryButton} disabled={redraftEod.isPending} onClick={() => redraftEod.mutate()}>
                  <Sparkles size={13} /> {redraftEod.isPending ? "Redrafting…" : "Redraft with assistant"}
                </button>
              ) : null}
              <button
                type="button"
                className={styles.primaryButton}
                disabled={!reportMarkdown.trim() || editorLocked || submitEod.isPending}
                onClick={() => submitEod.mutate()}
              >
                <Send size={14} /> {submitEod.isPending ? "Submitting…" : submitLabel}
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (shiftBlocked) {
      return (
        <div className={styles.record}>
          {shiftOpenPrompt(EOD_SHIFT_OPEN_PREFIX, EOD_SHIFT_OPEN_SUFFIX.web)}
          <p className={styles.recordNote}>Drafting reads your recorded day and asks the assistant for the narrative — activity context and outcomes, never a productivity claim.</p>
        </div>
      );
    }
    return (
      <div className={styles.record}>
        <div className={styles.facts}>
          <div className={styles.fact}>
            <span className={styles.factValue}>{eodDay?.signals?.completedTasks ?? 0}</span>
            <span className={styles.factLabel}>Completed</span>
            <span className={styles.factSub}>task outcomes today</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factValue}>{eodDay?.signals?.employeeUpdates ?? 0}</span>
            <span className={styles.factLabel}>Updates</span>
            <span className={styles.factSub}>recorded by you</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factValue}>{eodDay?.signals?.outputEvidence ?? 0}</span>
            <span className={styles.factLabel}>Evidence</span>
            <span className={styles.factSub}>output records</span>
          </div>
        </div>
        <div className={styles.recordAction}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={draftEod.isPending || assistantDraft.isPending || (historical && !selectedDay.data)}
            onClick={() => draftEod.mutate()}
          >
            <FileCheck2 size={14} /> {draftEod.isPending || assistantDraft.isPending ? "Drafting…" : historical ? `Draft EOD for ${calendarDateLabel(selectedDate)}` : "Draft EOD"}
          </button>
          <p className={styles.recordNote}>Drafting reads your recorded day and asks the assistant for the narrative — activity context and outcomes, never a productivity claim.</p>
        </div>
      </div>
    );
  })();

  const statusLabel = eodStatusLabel(status);
  const statusClass = status === "approved" ? styles.statusApproved : status === "rejected" ? styles.statusRejected : status === "pending_review" ? styles.statusSubmitted : "";

  return (
    <div className={styles.page} id="employee-eod-panel">
      <header className={`${styles.masthead} ${styles.reveal}`} style={{ "--delay": "0ms" } as CSSProperties}>
        <div className={styles.metaRow}><span>{selectedDate ? longDateLabel(selectedDate) : "Loading your review"}</span></div>
        <div className={styles.titleRow}>
          <h1>Review</h1>
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
                <span className={styles.eyebrow}>End of day</span>
                <h2 className={styles.surfaceTitle} id="review-eod-title">
                  {historical ? `Report for ${calendarDateLabel(selectedDate)}` : "Today's report"}
                </h2>
                <p className={styles.surfaceMeta}>
                  {historical ? "The recorded day stays read-only outside the report." : "One report per workday. The record is drafted from your day; nothing is filed until you submit it."}
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

          <section className={`${styles.section} ${styles.reveal}`} style={{ "--delay": "220ms" } as CSSProperties} aria-labelledby="review-evidence-title">
            <header className={styles.sectionHead}>
              <div>
                <h2 id="review-evidence-title">Recorded evidence</h2>
                <p className={styles.sectionMeta}>Activity context sampled by Worktivity. Evidence never proves productivity or completion.</p>
              </div>
              <span className={styles.sectionCount}>{evidence.length}</span>
            </header>
            {evidence.length ? (
              <ul className={styles.rows}>
                {evidence.map((item) => (
                  <li key={item.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowKicker}>{item.source === "loom" ? "Loom recording" : item.source}</span>
                      <span className={styles.rowTitle}>{item.title}</span>
                      {item.summary ? <p className={styles.rowCopy}>{item.summary}</p> : null}
                      {item.source === "loom" && item.url ? <a href={String(item.url)} target="_blank" rel="noreferrer" className={styles.rowCopy} style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Open recording</a> : null}
                    </div>
                    <div className={styles.rowActions}>
                      {item.event?.correction_status === "disputed" ? <span className={styles.status} style={{ color: "var(--status-error)" }}>Disputed</span> : null}
                      {item.evidence_event_id && item.event?.correction_status !== "disputed" ? (
                        <button type="button" className={styles.dispute} disabled={disputeEvidence.isPending} onClick={() => disputeEvidence.mutate(item.evidence_event_id)}>
                          Dispute this evidence
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>
                <strong className={styles.emptyTitle}>No evidence recorded for this day</strong>
                <p className={styles.emptyCopy}>Sampled activity shows up here once Worktivity has observations.</p>
              </div>
            )}
          </section>

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
            <p className={styles.historical}>Historical workspace: tasks and evidence are read-only, and the report editor drafts against {calendarDateLabel(selectedDate)}.</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
