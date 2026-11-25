import { ArrowLeft, ChevronRight, FileCheck2 } from "lucide-react";
import { EOD_SHIFT_OPEN_PREFIX, EOD_SHIFT_OPEN_SUFFIX } from "@wrazy/work-os-shared/shift-gate";
import { CheckedMoment } from "../../CheckedMoment";
import { formatWorkOsDate } from "../../dateFormat";
import { EodSubmittedReport } from "../../EodSubmittedReport";
import { OUTSTANDING_STATUS_META, outstandingRowMeta } from "../../NotificationsBell";
import { Empty } from "../../SharedUi";
import { EodComposer, EodLoadingState, EodShiftOpenNotice } from "../../taskSurfaces";
import { EodStructuredComposer } from "../../EodStructuredComposer";
import { EodSubmitReceipt } from "../../EodSubmitReceipt";
import { EodScreenshotPanel } from "../../ScreenshotGallery";
import { eodStructuredFromReport, type EodCompositionInput } from "../../eodStructured";
import type { DayData, EodScreenshotGallery, OutstandingEodDay } from "../../types";
import type { EodScreenshotContext, View } from "../types";

export interface EodDraftState {
  markdown: string;
  source: "ai" | "deterministic" | "simulated";
  screenshots?: EodScreenshotContext | null;
  screenshotSyncUnavailable?: boolean;
  loom?: { title: string | null; durationSeconds: number | null; createdLocalDate: string | null; verdict: string; url: string } | null;
}

export interface EodPreparingState {
  date: string;
  analyzed: number;
  total: number;
  pending: number | null;
  failed: number;
}

export interface EodGateState {
  gate: string;
  detail: string;
}

export function EodReviewView({
  eodDate,
  eodSubmitted,
  eodQueued,
  eodLanding,
  reviewSubmittedStatus,
  reviewDay,
  visibleDay,
  reportDayLoading,
  reportDayError,
  eodGate,
  eodPreparing,
  eodDraft,
  eodRedrafting,
  eodClockedOut,
  screenshotGallery,
  eodScreenshotNotice,
  reviewShiftOpen,
  outstandingDays,
  busy,
  onClearEodDate,
  onRetryReportDay,
  onShowAllEods,
  onOpenView,
  onOpenNotifications,
  onSelectOutstandingDay,
  onRetryEodGate,
  onDraftAnyway,
  onLoomPreview,
  onLoomDraft,
  onRedraft,
  onDeleteDraft,
  onRefine,
  onSubmit,
  onStructuredSave,
  onStructuredSummary,
  onStructuredSubmit,
  onReloadStructured,
  detailsReady,
  onResetSubmitted,
  onHideLanding,
  onCreateDraft,
}: {
  eodDate: string | null;
  eodSubmitted: boolean;
  eodQueued: boolean;
  eodLanding: boolean;
  reviewSubmittedStatus: "submitted" | "approved" | null;
  reviewDay: DayData | null;
  visibleDay: DayData | null;
  reportDayLoading: boolean;
  reportDayError: boolean;
  eodGate: EodGateState | null;
  eodPreparing: EodPreparingState | null;
  eodDraft: EodDraftState | null;
  eodRedrafting: boolean;
  eodClockedOut: boolean;
  screenshotGallery: EodScreenshotGallery | null;
  eodScreenshotNotice: string | null;
  reviewShiftOpen: boolean;
  outstandingDays: OutstandingEodDay[];
  busy: boolean;
  onClearEodDate: () => void;
  onRetryReportDay: () => void;
  onShowAllEods: () => void;
  onOpenView: (view: View) => void;
  onOpenNotifications: () => void;
  onSelectOutstandingDay: (date: string) => void;
  onRetryEodGate: () => void;
  onDraftAnyway: () => void;
  onLoomPreview: (url: string, targetDate?: string) => Promise<{
    title: string | null;
    durationSeconds: number | null;
    createdLocalDate: string | null;
    verdict: string;
    usableForDay: boolean;
    metadataAvailable: boolean;
  } | null>;
  onLoomDraft: (loom: { url: string; transcript?: string }) => Promise<{ ok: boolean; message?: string }>;
  onRedraft: () => void;
  onDeleteDraft: () => void;
  onRefine: (markdown: string, feedback: string, annotations?: Array<{ quote: string; comment: string }>) => Promise<boolean>;
  onSubmit: (markdown: string, idempotencyKey: string) => void;
  onStructuredSave: (input: EodCompositionInput) => Promise<"saved" | "queued">;
  onStructuredSummary: (input: EodCompositionInput, onChunk: (text: string) => void, signal: AbortSignal) => Promise<{ source: "otto" | "assembled" }>;
  onStructuredSubmit: (input: EodCompositionInput, idempotencyKey: string) => Promise<"saved" | "queued">;
  onReloadStructured: () => void;
  detailsReady: boolean;
  onResetSubmitted: () => void;
  onHideLanding: () => void;
  onCreateDraft: () => void;
}) {
  const structuredReview = eodStructuredFromReport(reviewDay?.report);
  return <main className="page">
    {eodDate && !eodSubmitted && !reviewSubmittedStatus && <div className="eod-day-context"><button type="button" onClick={onClearEodDate}><ArrowLeft size={14} /> Back to today</button><span>EOD for {formatWorkOsDate(eodDate)}.</span></div>}
    {eodDate && reportDayLoading ? <EodLoadingState title="Loading that day…" detail={`Fetching the recorded work for ${formatWorkOsDate(eodDate)}.`} />
      : eodDate && reportDayError ? <section className="panel"><Empty title="That day could not be loaded" body="The day's recorded work is unavailable right now. Check your connection and try again." /><div className="today-actions"><button onClick={onRetryReportDay}>Try again</button></div></section>
        : reviewDay?.report && !detailsReady && !eodSubmitted ? <EodLoadingState title="Loading your report…" detail={`Fetching the ${eodDate ? "recorded" : "structured"} draft${eodDate ? "" : " and today’s recorded work"}.`} />
        : reviewSubmittedStatus && !eodSubmitted && !eodLanding ? <EodSubmittedReport
            status={reviewSubmittedStatus}
            markdown={reviewDay?.report?.markdown}
            report={reviewDay?.report}
            date={reviewDay?.shiftDate ?? ""}
            onAllEods={onShowAllEods}
            onToday={() => { onClearEodDate(); onOpenView("day"); }}
          />
        : eodGate && !eodSubmitted ? <section className="panel"><Empty
            title={eodGate.gate === "no_tasks" ? "No tasks submitted for this day" : "No work activity recorded"}
            body={eodGate.detail}
          /><div className="today-actions"><button onClick={() => onOpenView("tasks")}>Open Tasks <ChevronRight size={14} /></button><button onClick={onRetryEodGate}>{eodRedrafting ? "Checking…" : "Try again"}</button></div></section>
          : eodPreparing && !eodDraft ? <EodLoadingState
            title="Preparing Worktivity analysis…"
            detail={`Checking ${eodDate ? "that day’s" : "today’s"} screenshots.`}
            progress={eodPreparing.pending == null
              ? null
              : `${eodPreparing.analyzed} of ${eodPreparing.total} frames analyzed${eodPreparing.pending > 0 ? ` — ${eodPreparing.pending} still analyzing` : ""}.`}
            onDraftAnyway={onDraftAnyway}
          />
            : reviewDay?.report && !eodSubmitted && eodRedrafting && !eodDraft ? <EodLoadingState title="Drafting your EOD…" detail={`Checking ${eodDate ? "that day’s" : "today’s"} recorded work and writing a draft for you to review.`} />
            : reviewDay?.report && !eodSubmitted && !eodLanding && (!eodRedrafting || eodDraft) ? (structuredReview ? <EodStructuredComposer
                key={String(reviewDay.report.id)}
                reportId={String(reviewDay.report.id)}
                structured={structuredReview}
                dayLabel={eodDate ? formatWorkOsDate(eodDate) : "today"}
                clockedOut={eodClockedOut}
                shiftOpen={reviewShiftOpen}
                loomEnabled={visibleDay?.access?.featureFlags?.loom_updates === true}
                onOpenDashboard={() => onOpenView("day")}
                onSave={onStructuredSave}
                onWriteSummary={onStructuredSummary}
                onSubmit={onStructuredSubmit}
                onReload={onReloadStructured}
                onRedraft={onRedraft}
                onDelete={["draft", "rejected"].includes(String(reviewDay.report.status)) && !reviewDay.report.submitted_at ? onDeleteDraft : undefined}
                screenshots={screenshotGallery && ((screenshotGallery.processed ?? 0) > 0 || (screenshotGallery.pending ?? 0) > 0 || (screenshotGallery.viewable?.length ?? 0) > 0) ? <>
                  {eodScreenshotNotice ? <p className="eod-screenshot-unavailable" role="status">Screenshot context: {eodScreenshotNotice}</p> : null}
                  {eodDraft?.screenshotSyncUnavailable ? <p className="eod-screenshot-unavailable" role="status">Screenshot context was unavailable for this draft. It uses the recorded work only.</p> : null}
                  <details className="eod-screenshot-context" open={false}>
                    <summary>{(screenshotGallery.processed ?? 0)} screenshot sample{(screenshotGallery.processed ?? 0) === 1 ? "" : "s"} analyzed for this day{(screenshotGallery.pending ?? 0) > 0 ? ` · ${screenshotGallery.pending} still analyzing` : ""}</summary>
                    <div className="eod-screenshot-body"><p>Sampled activity context only. It does not prove task completion, effort, or output quality.</p><EodScreenshotPanel context={eodDraft?.screenshots ?? null} gallery={screenshotGallery} /></div>
                  </details>
                </> : null}
              /> : <EodComposer
                initialMarkdown={eodDraft?.markdown ?? String(reviewDay.report.markdown ?? "")}
                source={eodDraft?.source ?? "deterministic"}
                dayLabel={eodDate ? formatWorkOsDate(eodDate) : "today"}
                redrafting={eodRedrafting}
                clockedOut={eodClockedOut}
                screenshotContext={eodDraft?.screenshots ?? null}
                screenshotGallery={screenshotGallery}
                screenshotSyncUnavailable={eodDraft?.screenshotSyncUnavailable === true}
                screenshotNotice={eodScreenshotNotice}
                preparing={eodPreparing}
                onDraftAnyway={onDraftAnyway}
                loomEnabled={visibleDay?.access?.featureFlags?.loom_updates === true}
                loomAttached={eodDraft?.loom ?? null}
                onLoomPreview={(url) => onLoomPreview(url, reviewDay?.shiftDate)}
                onLoomDraft={onLoomDraft}
                busy={busy}
                onRedraft={onRedraft}
                onDelete={["draft", "rejected"].includes(String(reviewDay.report.status)) && !reviewDay.report.submitted_at ? onDeleteDraft : undefined}
                shiftOpen={reviewShiftOpen}
                onOpenDashboard={() => onOpenView("day")}
                onRefine={onRefine}
                onSubmit={onSubmit}
              />)
              : eodSubmitted ? <EodSubmitReceipt queued={eodQueued} date={eodDate} onAllEods={onResetSubmitted} />
                : eodLanding || !reviewDay?.report ? <section className="panel eod-start">
                    <header className="eod-start-head">
                      <FileCheck2 size={20} />
                      <div>
                        <h2>{reviewSubmittedStatus ? "Your EODs" : eodDate ? `Draft the EOD for ${formatWorkOsDate(eodDate)}` : "Prepare today’s EOD"}</h2>
                        <p>{reviewSubmittedStatus ? "Read your submitted report or finish an earlier day’s EOD." : eodDate ? "Build the report from that day’s recorded work, review every line, then submit it. Drafting does not submit anything." : "Build the report from today’s recorded work, review every line, then submit it. Drafting does not submit anything."}</p>
                      </div>
                    </header>
                    {reviewSubmittedStatus ? <div className="eod-start-earlier"><ul><li><button type="button" onClick={onHideLanding}>
                      <span className="eod-start-earlier-main"><strong>{formatWorkOsDate(reviewDay?.shiftDate)}</strong><small>Read submitted report</small></span>
                      <span className={`eod-pill ${reviewSubmittedStatus}`}>{reviewSubmittedStatus === "approved" ? "Approved" : "Submitted"}</span><ChevronRight size={14} aria-hidden="true" />
                    </button></li></ul></div> : null}
                    {!eodDate && outstandingDays.length > 0 ? <section className="eod-start-earlier" aria-label="Earlier days without a submitted EOD">
                      <header><strong>Earlier days</strong><small>{outstandingDays.length} still need an EOD</small></header>
                      <ul>{outstandingDays.slice(0, 5).map((day) => {
                        const status = OUTSTANDING_STATUS_META[day.status];
                        return <li key={day.date}><button type="button" onClick={() => onSelectOutstandingDay(day.date)}>
                          <span className="eod-start-earlier-main"><strong>{formatWorkOsDate(day.date)}</strong><small>{outstandingRowMeta(day) || "Recorded workday"}</small></span>
                          <span className={`eod-pill ${status.className}`}>{status.label}</span>
                          <ChevronRight size={14} />
                        </button></li>;
                      })}</ul>
                      {outstandingDays.length > 5 ? <button type="button" className="eod-start-more" onClick={onOpenNotifications}>Show all {outstandingDays.length} days</button> : null}
                    </section> : null}
                    {reviewShiftOpen && !reviewSubmittedStatus ? <EodShiftOpenNotice prefix={EOD_SHIFT_OPEN_PREFIX} suffix={EOD_SHIFT_OPEN_SUFFIX.companion} onClockOut={() => onOpenView("day")} /> : null}
                    <div className="eod-start-actions">
                      {!eodDate && <button type="button" className="quiet-action" onClick={() => onOpenView("day")}>Return to today <ChevronRight size={14} /></button>}
                      {reviewShiftOpen || reviewSubmittedStatus ? null
                        : reviewDay?.report && !["draft", "rejected"].includes(String(reviewDay.report.status))
                          ? <small className="eod-start-status" role="status">{String(reviewDay.report.status) === "approved" ? "This day’s report is approved." : "This day’s report is already with your manager."}</small>
                          : <button className="primary" disabled={busy || eodRedrafting} onClick={onCreateDraft}>{eodRedrafting ? "Preparing…" : eodDate ? "Create draft for this day" : "Draft today’s EOD"}</button>}
                    </div>
                  </section>
                  : null}
  </main>;
}
