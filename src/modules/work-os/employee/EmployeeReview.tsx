"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ClipboardList,
  FileCheck2,
  FileSearch,
  RefreshCw,
  Send,
  Sparkles,
  Video,
  Wand2,
  X,
} from "lucide-react";
import EmployeeEodEvidence from "./EmployeeEodEvidence";
import { CheckedMoment } from "./CheckedMoment";
import { useEmployeeDay, useOutstandingEods } from "./useEmployeeDay";
import { HttpError, fetchJson, calendarDateLabel, requestId, type AnyRow, type EmployeeDayResponse, type OutstandingEodDay } from "./model";
import { assistantDraftFallbackNotice, assistantDraftNotice, prepareOneScreenshotRound, stripBottleneckSection, type AssistantEodDraftResponse } from "./eod";
import {
  EmptyState,
  IconButton,
  Masthead,
  Notice,
  Panel,
  PanelHeader,
  PrimaryButton,
  QuietButton,
  SecondaryButton,
  Skeleton,
  StatusPill,
  SyncChip,
  inlineInputClass,
  inputClass,
  inputStyle,
} from "./ui";

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

function proposalSummary(proposal: AnyRow) {
  const change = proposal.proposed_change ?? {};
  return change.name || change.title || change.summary || change.progress || change.description || proposal.input_text;
}

export default function EmployeeReview() {
  const { day, refresh, sync, syncing } = useEmployeeDay();
  const outstanding = useOutstandingEods();
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
  /* The report date the editor is currently showing; an assistant response for
     another day must never alter the active editor. */
  const activeReportDateRef = useRef<string>("");
  activeReportDateRef.current = eodDay?.shiftDate ?? "";

  type AssistantDraftMode = "draft" | "redraft" | "refine" | "loom";
  const assistantDraft = useMutation({
    mutationFn: (variables: { mode: AssistantDraftMode; date: string; draft?: string; feedback?: string; loom?: { url: string; transcript?: string } }) =>
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
      if (result.markdown) setReportMarkdown(result.markdown);
      setDraftSource("ai");
      if (variables.mode === "refine") setEodNotice({ tone: "info", text: "The draft was refined from your feedback. Your bottleneck answer was not changed." });
      else if (variables.mode === "loom") setEodNotice({ tone: "info", text: "Draft rebuilt from your Loom recording. Review every line." });
      else if (result.clockedOut) setEodNotice({ tone: "info", text: "You were clocked out automatically and the assistant drafted your EOD. Review every line." });
      else setEodNotice({ tone: "info", text: assistantDraftNotice(result) });
      void refresh();
    },
    onError: (error, variables) => {
      if (variables.date !== activeReportDateRef.current) return;
      const gated = error instanceof HttpError && error.status === 409;
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

  const draftEod = useMutation({
    mutationFn: async () => {
      if (!eodDay?.shiftDate) throw new Error("Load the day before drafting its EOD");
      const date = eodDay.shiftDate;
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
  const error = day.error || selectedDay.error || outstanding.error || draftEod.error || submitEod.error || review.error || disputeEvidence.error;
  const status = String(eodReport?.status || "");
  const editorLocked = status === "pending_review" || status === "approved";
  const submitLabel = status === "pending_review" ? "Submitted for review" : status === "approved" ? "Approved" : "Submit for review";

  const eodPanel = (() => {
    if (eodConfirmation) {
      return (
        <div className="grid gap-2" role="status">
          <div className="flex items-center">
            <QuietButton onClick={() => setEodConfirmation(false)} className="!px-2" aria-label="Back to all EODs"><ArrowLeft size={14} /> All EODs</QuietButton>
          </div>
          <div className="grid justify-items-center gap-1 pb-2 pt-1 text-center">
            <CheckedMoment className="!h-[176px] !w-[176px]" />
            <strong className="text-[14px] font-semibold text-[var(--text-primary)]">EOD submitted</strong>
            <p className="max-w-[340px] text-[12px] leading-5 text-[var(--text-tertiary)]">
              {historical ? `Your report for ${calendarDateLabel(selectedDate)} is with your manager.` : "Your report is with your manager. You are done for today."}
            </p>
          </div>
        </div>
      );
    }
    if (historical && selectedDay.isLoading && !selectedDay.data) {
      return (
        <div className="grid gap-3 px-5 py-5" aria-busy="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }
    if (historical && selectedDay.error && !selectedDay.data) {
      return (
        <EmptyState
          title="That day could not be loaded"
          message={(selectedDay.error as Error).message}
          action={<SecondaryButton onClick={() => void selectedDay.refetch()}>Try again</SecondaryButton>}
        />
      );
    }
    if (eodReport) {
      return (
        <>
          {eodNotice ? <Notice tone={eodNotice.tone} className="mb-3">{eodNotice.text}</Notice> : null}
          <textarea
            value={reportMarkdown}
            onChange={(event) => setReportMarkdown(event.target.value)}
            rows={16}
            className={`${inputClass} resize-y`}
            style={{ ...inputStyle, minHeight: 280 }}
            disabled={editorLocked}
            aria-label="EOD report draft"
          />
          {!editorLocked ? (
            <div className="mt-3 rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Ask the assistant to adjust this draft</span>
                <button type="button" className="text-[12px] font-semibold" style={{ color: "var(--accent-deep)" }} onClick={() => { setRefineOpen((value) => !value); setEodNotice(null); }}>
                  {refineOpen ? "Close" : "Refine draft"}
                </button>
              </div>
              {refineOpen ? (
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  <input
                    value={refineInput}
                    onChange={(event) => setRefineInput(event.target.value)}
                    placeholder="e.g. Lead with the settlement outcome and drop the stale ticket."
                    className={`${inputClass} min-w-[220px] flex-1`}
                    style={inputStyle}
                    aria-label="EOD refinement request"
                  />
                  <SecondaryButton
                    disabled={!refineInput.trim() || assistantDraft.isPending}
                    onClick={() => assistantDraft.mutate({ mode: "refine", date: eodDay?.shiftDate ?? "", draft: stripBottleneckSection(reportMarkdown), feedback: refineInput.trim() })}
                  >
                    <Wand2 size={13} /> {assistantDraft.isPending ? "Refining…" : "Apply refinement"}
                  </SecondaryButton>
                </div>
              ) : null}
            </div>
          ) : null}
          {!editorLocked && day.data?.access?.featureFlags?.loom_updates === true ? (
            <div className="mt-3 rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Recorded a Loom for this day?</span>
                <button type="button" className="text-[12px] font-semibold" style={{ color: "var(--accent-deep)" }} onClick={() => { setLoomOpen((value) => !value); setEodNotice(null); }}>
                  {loomOpen ? "Close" : "Analyze a Loom"}
                </button>
              </div>
              {loomOpen ? (
                <div className="mt-2 grid gap-2">
                  <input
                    value={loomUrl}
                    onChange={(event) => setLoomUrl(event.target.value)}
                    placeholder="https://www.loom.com/share/…"
                    className={inputClass}
                    style={inputStyle}
                    aria-label="Loom share link"
                  />
                  <textarea
                    value={loomTranscript}
                    onChange={(event) => setLoomTranscript(event.target.value)}
                    rows={3}
                    maxLength={50000}
                    placeholder="Paste the transcript when Loom has none (optional)."
                    className={`${inputClass} resize-y`}
                    style={inputStyle}
                    aria-label="Loom transcript"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] leading-5 text-[var(--text-tertiary)]">Draft context only — it never files an update, and a recording from another day is refused.</p>
                    <SecondaryButton
                      disabled={!loomUrl.trim() || assistantDraft.isPending}
                      onClick={() => assistantDraft.mutate({ mode: "loom", date: eodDay?.shiftDate ?? "", loom: { url: loomUrl.trim(), transcript: loomTranscript.trim() || undefined } })}
                    >
                      <Video size={13} /> {assistantDraft.isPending ? "Analyzing…" : "Rebuild draft"}
                    </SecondaryButton>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] leading-5 text-[var(--text-tertiary)]">
              {status === "pending_review" ? "Submitted — waiting for review."
                : status === "approved" ? "Approved."
                  : status === "rejected" ? "Changes were requested. Update the report and resubmit it."
                    : "Nothing is filed until you submit."}
              {draftSource ? ` · ${draftSource === "ai" ? "Assistant draft" : "Standard draft"}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {!editorLocked ? (
                <SecondaryButton
                  disabled={redraftEod.isPending}
                  onClick={() => redraftEod.mutate()}
                >
                  <Sparkles size={13} /> {redraftEod.isPending ? "Redrafting…" : "Redraft with assistant"}
                </SecondaryButton>
              ) : null}
              <PrimaryButton
                disabled={!reportMarkdown.trim() || editorLocked || submitEod.isPending}
                onClick={() => submitEod.mutate()}
              >
                <Send size={14} /> {submitEod.isPending ? "Submitting…" : submitLabel}
              </PrimaryButton>
            </div>
          </div>
        </>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton
          disabled={draftEod.isPending || assistantDraft.isPending || (historical && !selectedDay.data)}
          onClick={() => draftEod.mutate()}
        >
          <FileCheck2 size={14} /> {draftEod.isPending || assistantDraft.isPending ? "Drafting…" : historical ? `Draft EOD for ${calendarDateLabel(selectedDate)}` : "Draft EOD"}
        </PrimaryButton>
        <p className="text-[11px] text-[var(--text-tertiary)]">Drafting reads your recorded day and asks the assistant for the narrative — activity context and outcomes, never a productivity claim.</p>
      </div>
    );
  })();

  return (
    <div id="employee-eod-panel">
      <Masthead
        eyebrow="Work OS"
        title="Review"
        meta={historical ? `Drafting for ${calendarDateLabel(selectedDate)} · historical records are read-only outside the report.` : "Your end-of-day report, proposed changes, and recorded evidence."}
        actions={
          <>
            <input
              type="date"
              value={selectedDate}
              max={day.data?.shiftDate ?? undefined}
              onChange={(event) => setSelectedDate(event.target.value)}
              aria-label="Report date"
              className={`${inlineInputClass} w-auto`}
              style={inputStyle}
            />
            {historical ? <SecondaryButton onClick={() => setSelectedDate(day.data?.shiftDate ?? "")}>Back to today</SecondaryButton> : null}
            <IconButton label="Refresh review" onClick={() => void refresh()} disabled={day.isFetching || selectedDay.isFetching}>
              <RefreshCw size={15} className={day.isFetching || selectedDay.isFetching ? "animate-spin" : undefined} />
            </IconButton>
            <SyncChip sync={day.data?.niftySync} syncing={syncing} onSync={() => sync.mutate()} />
          </>
        }
      />

      {error ? <Notice tone="err" className="mb-5">{(error as Error).message}</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-5">
          <Panel>
            <div id="employee-eod-editor">
              <PanelHeader
                icon={<FileCheck2 size={16} />}
                title="End-of-day report"
                meta={historical ? `Report for ${calendarDateLabel(selectedDate)}.` : "One report per workday."}
                actions={<StatusPill tone={status === "approved" ? "done" : status === "rejected" ? "error" : status === "pending_review" ? "info" : "open"}>{status ? status.replaceAll("_", " ") : "not drafted"}</StatusPill>}
              />
            </div>
            <div className="px-5 py-5">{eodPanel}</div>
          </Panel>

          {!historical && proposals.length ? (
            <Panel>
              <PanelHeader
                icon={<ClipboardList size={16} />}
                title="Review proposed changes"
                meta="Otto proposed these from your updates. Nothing is applied until you approve it."
              />
              <ul>
                {proposals.map((proposal) => (
                  <li key={proposal.id} className="flex flex-wrap items-start gap-3 border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">{String(proposal.operation ?? "").replaceAll("_", " ")}</p>
                      <p className="mt-1 text-[13px] font-medium text-[var(--text-primary)]">{proposal.task?.title || proposal.before_state?.title || proposalSummary(proposal)}</p>
                      {proposal.task?.title || proposal.before_state?.title ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{proposalSummary(proposal)}</p> : null}
                      {proposal.failure_reason ? <p className="mt-2 text-[12px]" style={{ color: "var(--status-warn)" }}>{proposal.failure_reason}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      <SecondaryButton aria-label="Reject proposal" onClick={() => review.mutate({ id: proposal.id, decision: "reject" })} disabled={review.isPending}>
                        <X size={14} /> Reject
                      </SecondaryButton>
                      {proposal.status !== "stale" ? (
                        <PrimaryButton aria-label="Accept proposal" onClick={() => review.mutate({ id: proposal.id, decision: "accept" })} disabled={review.isPending}>
                          <Check size={14} /> Approve
                        </PrimaryButton>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              icon={<FileSearch size={16} />}
              title="Recorded evidence"
              meta="Activity context sampled by Worktivity. Evidence never proves productivity or completion."
            />
            {evidence.length ? (
              <ul>
                {evidence.map((item) => (
                  <li key={item.id} className="border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-[var(--text-primary)]">{item.title}</p>
                      <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{item.source === "loom" ? "Loom recording" : item.source}</span>
                    </div>
                    {item.summary ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{item.summary}</p> : null}
                    {item.source === "loom" && item.url ? <a href={String(item.url)} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-[11px] font-semibold" style={{ color: "var(--accent-deep)" }}>Open recording</a> : null}
                    <div className="mt-2 flex items-center gap-3">
                      {item.evidence_event_id && item.event?.correction_status !== "disputed" ? (
                        <button type="button" disabled={disputeEvidence.isPending} onClick={() => disputeEvidence.mutate(item.evidence_event_id)} className="text-[11px] font-semibold disabled:opacity-50" style={{ color: "var(--status-warn)" }}>
                          Dispute this evidence
                        </button>
                      ) : null}
                      {item.event?.correction_status === "disputed" ? <StatusPill tone="overdue">Disputed</StatusPill> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<FileSearch size={20} />} title="No evidence recorded for this day" message="Sampled activity shows up here once Worktivity has observations." />
            )}
          </Panel>

          <EmployeeEodEvidence
            date={selectedDate}
            timezone={day.data?.shift?.timezone}
            enabled={day.data?.access?.featureFlags?.screenshot_summaries === true}
          />
        </div>

        <aside className="grid content-start gap-5">
          <Panel>
            <PanelHeader
              icon={<AlertTriangle size={16} />}
              title="Outstanding EODs"
              meta={outstanding.data?.count ? `${outstanding.data.count} past day${outstanding.data.count === 1 ? "" : "s"} without a submitted report.` : "Every past workday has a report."}
            />
            {outstanding.isLoading && !outstanding.data ? (
              <div className="grid gap-3 px-5 py-4" aria-busy="true">
                <Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-44" /><Skeleton className="h-4 w-36" />
              </div>
            ) : outstanding.error && !outstandingDays.length ? (
              <EmptyState
                title="Could not load outstanding EODs"
                message={(outstanding.error as Error).message}
                action={<SecondaryButton onClick={() => void outstanding.refetch()}>Try again</SecondaryButton>}
              />
            ) : outstandingDays.length ? (
              <ul>
                {outstandingDays.map((outstandingDay) => {
                  const meta = EOD_STATUS_META[outstandingDay.status];
                  return (
                    <li key={outstandingDay.date} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDate(outstandingDay.date);
                          window.requestAnimationFrame(() => document.getElementById("employee-eod-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                        }}
                        className="flex w-full items-start justify-between gap-3 px-5 py-3 text-left transition hover:bg-[var(--bg-tertiary)]"
                      >
                        <span className="min-w-0">
                          <span className="block text-[12px] font-semibold text-[var(--text-primary)]">{calendarDateLabel(outstandingDay.date)}</span>
                          <span className="mt-0.5 block text-[11px] text-[var(--text-tertiary)]">{outstandingRowMeta(outstandingDay) || "Recorded workday"}</span>
                        </span>
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={<Check size={18} />} title="You’re caught up" message="No past workday is missing a submitted EOD." />
            )}
          </Panel>

          {historical ? (
            <Notice tone="info">Historical workspace: tasks and evidence are read-only, and the report editor drafts against {calendarDateLabel(selectedDate)}.</Notice>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
