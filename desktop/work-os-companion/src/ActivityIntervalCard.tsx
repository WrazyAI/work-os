import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Camera, Check, ChevronLeft, ChevronRight, Github, Image as ImageIcon, Pencil, StickyNote, X } from "lucide-react";
import { ScreenshotImage, type PreviewResolver } from "./ScreenshotGallery";
import { useModalScrollLock } from "./modalScrollLock";
import type { ActivityInterval, ActivityIntervalCard as ActivityIntervalCardData, ActivityIntervalEvidence } from "./types";

/** The Tasks stream and the prompt turn both send the full disclosure now;
 * older compact payloads without the evidence fields still render. */
type ActivityIntervalModel = ActivityIntervalCardData;

const STATUS_LABEL: Record<ActivityInterval["reviewStatus"], string> = {
  inferred: "Not reviewed",
  confirmed: "Confirmed",
  amended: "Updated by you",
};

function formatPart(date: Date, timezone: string | null | undefined, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone || undefined, ...options }).formatToParts(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  }
}

function clockLabel(iso: string, timezone: string | null | undefined): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = formatPart(date, timezone, { hour: "numeric", minute: "2-digit", hour12: true });
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  return `${hour}:${minute} ${dayPeriod}`.trim();
}

function dateLabel(iso: string, timezone: string | null | undefined): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = formatPart(date, timezone, { month: "long", day: "numeric", year: "numeric" });
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const month = get("month");
  const day = get("day");
  const year = get("year");
  return month && day && year ? `${month} ${day}, ${year}` : date.toDateString();
}

/** Employee-local calendar day (YYYY-MM-DD) for the interval start. */
export function localDateKey(iso: string, timezone: string | null | undefined): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = formatPart(date, timezone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

const FAILURE_COPY: Record<string, string> = {
  no_usable_frames: "No usable activity frames were available for this interval.",
  daily_cap: "The daily recap limit was reached, so no recap was produced for this interval.",
  screenshot_summaries_disabled: "Activity recaps are not enabled for this workspace.",
  activity_intervals_disabled: "Activity recaps are turned off for this workspace.",
  feature_disabled: "Activity recaps are currently turned off.",
  consent_required: "Activity recaps need screenshot-analysis consent before they can run.",
};

function unavailableCopy(interval: ActivityIntervalModel): string {
  const reason = interval.failureReason ?? "";
  for (const [key, copy] of Object.entries(FAILURE_COPY)) if (reason.includes(key)) return copy;
  return "This interval recap could not be produced. Your next check-in still works normally.";
}

/** Quiet coverage summary for the evidence disclosure: "8 of 28 frames
 * analyzed", or just "8 frames analyzed" when nothing was left out. */
function coverageLabel(coverage: ActivityIntervalModel["coverage"]): string | null {
  const analyzed = coverage?.framesAnalyzed;
  if (analyzed == null || analyzed < 0) return null;
  const recorded = coverage?.framesRecorded;
  if (recorded != null && recorded > analyzed) return `${analyzed} of ${recorded} frames analyzed`;
  return `${analyzed} frame${analyzed === 1 ? "" : "s"} analyzed`;
}

/** Animates a recap panel open and closed by its measured height. The CSS
 * grid-rows trick proved unreliable inside the nested card grid (the row never
 * re-measured its content), so the panel owns its height: it animates to the
 * measured content height, settles to auto, and animates back to zero. */
function AnimatedPanel({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);
  const [height, setHeight] = useState<number | "auto">(open ? "auto" : 0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The first render already matches the requested state; only a later
    // toggle should animate, so a closed panel never flashes its content.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (open) {
      setHeight(el.scrollHeight);
      const timer = window.setTimeout(() => setHeight("auto"), 240);
      return () => window.clearTimeout(timer);
    }
    setHeight(el.scrollHeight);
    const timer = window.setTimeout(() => {
      // Force the pixel height to be the computed style before collapsing, so
      // the transition always has a start value (auto cannot interpolate).
      void el.offsetHeight;
      setHeight(0);
    }, 20);
    return () => window.clearTimeout(timer);
  }, [open]);
  return (
    <div
      ref={ref}
      className={`chat-activity-panel-clip${open ? " is-open" : ""}`}
      style={{ height: height === "auto" ? "auto" : `${height}px` }}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="chat-activity-panel" id={id}>{children}</div>
    </div>
  );
}

/** Splits a model-written activity phrase into its leading clock time and the
 * activity itself, so the card can set the time as a quiet pill. The time
 * token is captured greedily first, then a separator (or space) followed by
 * real activity text is required, so a time-only phrase is never split into a
 * pill plus a stray fragment like "PM". */
export function splitActivityTime(activity: string): { time: string | null; text: string } {
  const whole = { time: null as string | null, text: activity.trim() };
  const prefix = activity.trim().match(/^(\d{1,2}:\d{2}(?:\s*[AP]M)?(?:\s*[–—-]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)?)(.*)$/i);
  if (!prefix) return whole;
  const rest = prefix[2].match(/^\s*(?:[–—:-]\s*|\s+)([\p{L}\p{N}].*)$/iu);
  if (!rest) return whole;
  const time = prefix[1].replace(/\s+/g, " ").trim();
  const text = rest[1].trim();
  return time && text ? { time, text } : whole;
}

interface ActivityIntervalCardProps {
  interval: ActivityIntervalModel;
  timezone?: string | null;
  currentDate?: string | null;
  onDecide?: (id: string, action: "confirm" | "amend", feedback?: string) => Promise<void>;
  deciding?: boolean;
  defaultPanel?: "notes" | "evidence" | null;
  resolveSrc?: PreviewResolver;
  /** Chat-bubble presentation: an Edit action that hands editing to the
   * composer instead of expanding an inline field. */
  onEdit?: () => void;
}

/** One Activity Interval Review card: headline, evidence-bounded detail,
 * provenance chip, confirm/amend actions, and a collapsed disclosure for its
 * exact analyzed screenshots and recorded GitHub activity. Looks like a chat
 * card, not a dashboard tile. */
export function ActivityIntervalCard({
  interval,
  timezone,
  currentDate,
  onDecide,
  deciding = false,
  defaultPanel = null,
  resolveSrc,
  onEdit,
}: ActivityIntervalCardProps) {
  const [feedback, setFeedback] = useState("");
  const [amending, setAmending] = useState(false);
  const [openPanel, setOpenPanel] = useState<"notes" | "evidence" | null>(defaultPanel);
  const [lightbox, setLightbox] = useState<ActivityIntervalEvidence | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useModalScrollLock(lightbox !== null);

  const evidence = useMemo(() => (interval.evidence ?? []).filter((entry) => entry.usedInModel), [interval.evidence]);
  const recordedActivity = interval.recordedActivity ?? [];
  const retained = evidence.filter((entry) => entry.summaryId && entry.retained);
  const evidenceExpired = interval.evidenceExpired === true || retained.length < evidence.length;
  // Only claim a screenshot count when the payload actually carries evidence
  // info; a legacy compact card must not render a false "0 screenshots".
  const evidenceKnown = interval.evidenceCount != null || interval.evidence != null;
  const screenshotCount = interval.evidenceCount ?? evidence.length;
  const coverage = coverageLabel(interval.coverage);
  const evidenceParts = [
    ...(evidenceKnown ? [`${screenshotCount} screenshot${screenshotCount === 1 ? "" : "s"}`] : []),
    ...(recordedActivity.length > 0 ? [`${recordedActivity.length} GitHub event${recordedActivity.length === 1 ? "" : "s"}`] : []),
  ];
  const showScreenshotGroup = evidenceKnown && (screenshotCount > 0 || evidenceExpired);
  const showEvidence = showScreenshotGroup || recordedActivity.length > 0;
  // The notes panel is also the home of the inferred provenance line, so an
  // inferred recap keeps the button even when it has no gaps to list.
  const showNotes = (interval.uncertainties?.length ?? 0) > 0 || interval.reviewStatus === "inferred";
  const showDate = !!currentDate && localDateKey(interval.windowStart, timezone) !== currentDate;

  const closeLightbox = useCallback(() => {
    setLightbox(null);
    restoreFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeLightbox(); return; }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = retained.findIndex((entry) => entry.summaryId === lightbox.summaryId);
      const next = event.key === "ArrowLeft" ? index - 1 : index + 1;
      if (next >= 0 && next < retained.length) setLightbox(retained[next] ?? null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeLightbox, lightbox, retained]);

  const submitFeedback = useCallback(async () => {
    const note = feedback.trim();
    if (!note || !onDecide || deciding) return;
    await onDecide(interval.id, "amend", note);
    setAmending(false);
    setFeedback("");
  }, [deciding, feedback, interval.id, onDecide]);

  if (interval.generationStatus !== "ready") {
    return (
      <article className="chat-activity-card is-unavailable">
        <header className="chat-activity-head">
          <strong className="chat-activity-label">{interval.label}</strong>
          <span className="chat-activity-status is-unavailable">No recap</span>
        </header>
        <p className="chat-activity-detail">{unavailableCopy(interval)}</p>
      </article>
    );
  }

  return (
    <article className="chat-activity-card" aria-label={`Activity recap for ${interval.label}`}>
      <header className="chat-activity-head">
        <span className="chat-activity-when">
          <strong className="chat-activity-label">{interval.label}</strong>
          {showDate ? <small>{dateLabel(interval.windowStart, timezone)}</small> : null}
        </span>
        <span className={`chat-activity-status is-${interval.reviewStatus}`}>{STATUS_LABEL[interval.reviewStatus]}</span>
      </header>
      {interval.headline ? <p className="chat-activity-headline">{interval.headline}</p> : null}
      {interval.detail ? <p className="chat-activity-detail">{interval.detail}</p> : null}
      {interval.activities?.length ? (
        <ul className="chat-activity-bullets">
          {interval.activities.map((activity, index) => {
            const { time, text } = splitActivityTime(activity);
            return (
              <li key={`${index}-${activity.slice(0, 24)}`} className={time ? "has-time" : undefined}>
                {time ? <time className="chat-activity-time-pill">{time}</time> : null}
                <span className="chat-activity-activity-text">{text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {interval.workflow && interval.workflow.length > 1 ? (
        <div className="chat-activity-flow">
          <span className="chat-activity-flow-label">Flow</span>
          <span className="chat-activity-flow-track">
            {interval.workflow.map((phase, index) => (
              <Fragment key={`${index}-${phase}`}>
                {index > 0 ? <span className="chat-activity-flow-sep" aria-hidden="true">→</span> : null}
                <span className="chat-activity-flow-chip">{phase}</span>
              </Fragment>
            ))}
          </span>
        </div>
      ) : null}
      {interval.reviewStatus === "amended" && interval.employeeFeedback ? (
        <p className="chat-activity-note"><strong>Your note:</strong> {interval.employeeFeedback}</p>
      ) : null}

      {interval.reviewStatus === "inferred" && onDecide ? (
        onEdit ? (
          <div className="chat-activity-decide">
            <p className="chat-activity-ask">{deciding ? "Saving…" : "Sounds good?"}</p>
            <div className="chat-activity-actions">
              <button type="button" className="chat-activity-confirm is-icon" aria-label="Looks good" title="Looks good" disabled={deciding} onClick={() => void onDecide(interval.id, "confirm")}>
                <Check size={16} aria-hidden="true" />
              </button>
              <button type="button" className="chat-activity-quiet is-icon" aria-label="Edit" title="Edit" disabled={deciding} onClick={onEdit}>
                <Pencil size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : amending ? (
          <div className="chat-activity-amend">
            <label className="sr-only" htmlFor={`activity-note-${interval.id}`}>Add or correct this recap</label>
            <textarea
              id={`activity-note-${interval.id}`}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Anything the recap missed or got wrong?"
              maxLength={4000}
              rows={3}
              disabled={deciding}
            />
            <div className="chat-activity-actions">
              <button type="button" className="chat-activity-confirm" disabled={deciding || !feedback.trim()} onClick={() => void submitFeedback()}>
                {deciding ? "Saving…" : "Send note"}
              </button>
              <button type="button" className="chat-activity-quiet" disabled={deciding} onClick={() => { setAmending(false); setFeedback(""); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="chat-activity-actions">
            {deciding ? <span className="chat-activity-saving" role="status">Saving…</span> : null}
            <button type="button" className="chat-activity-confirm is-icon" aria-label="Looks right" title="Looks right" disabled={deciding} onClick={() => void onDecide(interval.id, "confirm")}>
              <Check size={16} aria-hidden="true" />
            </button>
            <button type="button" className="chat-activity-quiet is-icon" aria-label="Add or correct" title="Add or correct" disabled={deciding} onClick={() => setAmending(true)}>
              <Pencil size={14} aria-hidden="true" />
            </button>
          </div>
        )
      ) : null}

      {showNotes || showEvidence ? (
        <div className="chat-activity-panels-area">
        <div className="chat-activity-panels">
          {showNotes ? (
            <button
              type="button"
              className={`chat-activity-panel-button${openPanel === "notes" ? " is-active" : ""}`}
              aria-expanded={openPanel === "notes"}
              aria-controls={`activity-notes-${interval.id}`}
              onClick={() => setOpenPanel(openPanel === "notes" ? null : "notes")}
            >
              <StickyNote size={12} aria-hidden="true" />
              Extra notes
            </button>
          ) : null}
          {showEvidence ? (
            <button
              type="button"
              className={`chat-activity-panel-button is-evidence${openPanel === "evidence" ? " is-active" : ""}`}
              aria-expanded={openPanel === "evidence"}
              aria-controls={`activity-evidence-${interval.id}`}
              aria-label={evidenceParts.length ? `Evidence: ${evidenceParts.join(", ")}` : "Evidence"}
              onClick={() => setOpenPanel(openPanel === "evidence" ? null : "evidence")}
            >
              {evidenceKnown ? (
                <span className="chat-activity-panel-metric"><Camera size={12} aria-hidden="true" /> {screenshotCount}</span>
              ) : null}
              {recordedActivity.length > 0 ? (
                <span className="chat-activity-panel-metric"><Github size={12} aria-hidden="true" /> {recordedActivity.length}</span>
              ) : null}
              {evidenceParts.length ? (
                <span className="chat-activity-panel-tooltip" aria-hidden="true">{evidenceParts.join(" · ")}</span>
              ) : null}
            </button>
          ) : null}
        </div>

      {showNotes ? (
        <AnimatedPanel open={openPanel === "notes"} id={`activity-notes-${interval.id}`}>
          {interval.reviewStatus === "inferred" ? (
            <p className="chat-activity-provenance">Inferred from your screenshots — add or correct anything missing.</p>
          ) : null}
          {interval.uncertainties?.length ? (
            <ul className="chat-activity-panel-notes">
              {interval.uncertainties.map((note) => <li key={note}>{note}</li>)}
            </ul>
          ) : null}
        </AnimatedPanel>
      ) : null}

      {showEvidence ? (
        <AnimatedPanel open={openPanel === "evidence"} id={`activity-evidence-${interval.id}`}>
          {showScreenshotGroup ? (
            <section className="chat-activity-panel-section">
              <header className="chat-activity-panel-head">
                <ImageIcon size={11} aria-hidden="true" />
                <span>Screenshots</span>
                <span className="chat-activity-panel-count">{screenshotCount}</span>
              </header>
              {evidence.length > 0 ? (
                <ul>
                  {evidence.map((entry, index) => {
                    const viewable = !!(entry.summaryId && entry.retained);
                    const copy = (
                      <>
                        <time>{clockLabel(entry.capturedAt, timezone)}</time>
                        <span className="chat-activity-frame-copy">
                          {entry.frameSummary || "No frame summary was recorded."}
                          {entry.visibleApp ? <small>{entry.visibleApp}</small> : null}
                        </span>
                      </>
                    );
                    return (
                      <li key={entry.summaryId ?? `${entry.capturedAt}-${index}`}>
                        {viewable ? (
                          <button
                            type="button"
                            className="chat-activity-frame"
                            onClick={(event) => { restoreFocusRef.current = event.currentTarget; setLightbox(entry); }}
                            aria-label={`Open screenshot captured at ${clockLabel(entry.capturedAt, timezone)}`}
                          >
                            <ScreenshotImage
                              summaryId={entry.summaryId as string}
                              size="thumb"
                              srcOverride={resolveSrc?.(entry.summaryId as string, "thumb")}
                              alt={`Screenshot captured at ${clockLabel(entry.capturedAt, timezone)}${entry.visibleApp ? ` in ${entry.visibleApp}` : ""}`}
                              className="eod-shot-thumb"
                            />
                            {copy}
                          </button>
                        ) : (
                          <span className="chat-activity-frame is-static eod-shot-hour-row no-thumb">{copy}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="chat-activity-evidence-note">Screenshot details are not available in this recap view.</p>
              )}
              {evidenceExpired ? (
                <small className="chat-activity-expired">
                  {retained.length > 0
                    ? "Some screenshots expired under the 30-day retention policy."
                    : "Screenshots expired under the 30-day retention policy. The recap text is kept."}
                </small>
              ) : null}
            </section>
          ) : null}
          {recordedActivity.length > 0 ? (
            <section className="chat-activity-panel-section">
              <header className="chat-activity-panel-head">
                <Github size={11} aria-hidden="true" />
                <span>GitHub activity</span>
                <span className="chat-activity-panel-count">{recordedActivity.length}</span>
              </header>
              <div className="chat-activity-github">
                <ul>
                  {recordedActivity.map((item, index) => (
                    <li key={`${item.relation}-${index}-${item.description.slice(0, 24)}`}>
                      <span
                        className={`chat-activity-github-tag is-${item.relation}`}
                        title={item.relation === "performed" ? "Performed by your GitHub accounts" : "Triggered by your work (CI, deployments, reviews on your pull requests)"}
                      >
                        {item.relation === "performed" ? "You" : "Your work"}
                      </span>
                      {item.url
                        ? <a href={item.url} target="_blank" rel="noreferrer">{item.description}</a>
                        : <span>{item.description}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
          {coverage ? <small className="chat-activity-coverage">{coverage}</small> : null}
        </AnimatedPanel>
      ) : null}
        </div>
      ) : null}

      {lightbox && createPortal(
        <div className="eod-shot-lightbox" role="dialog" aria-modal="true" aria-label="Screenshot preview" onPointerDown={(event) => { if (event.target === event.currentTarget) closeLightbox(); }}>
          <figure>
            <ScreenshotImage
              summaryId={lightbox.summaryId as string}
              size="preview"
              srcOverride={resolveSrc?.(lightbox.summaryId as string, "preview")}
              alt={`Screenshot captured at ${clockLabel(lightbox.capturedAt, timezone)}${lightbox.visibleApp ? ` in ${lightbox.visibleApp}` : ""}`}
              className="eod-shot-lightbox-image"
            />
            <figcaption>
              <time>{clockLabel(lightbox.capturedAt, timezone)}</time>
              {lightbox.visibleApp ? ` · ${lightbox.visibleApp}` : ""}
              {lightbox.frameSummary ? ` — ${lightbox.frameSummary}` : ""}
            </figcaption>
            <div className="eod-shot-lightbox-nav">
              <button type="button" className="icon" aria-label="Previous screenshot" disabled={retained.findIndex((entry) => entry.summaryId === lightbox.summaryId) <= 0} onClick={() => setLightbox(retained[Math.max(0, retained.findIndex((entry) => entry.summaryId === lightbox.summaryId) - 1)] ?? lightbox)}><ChevronLeft size={16} /></button>
              <button type="button" className="icon" aria-label="Next screenshot" disabled={retained.findIndex((entry) => entry.summaryId === lightbox.summaryId) >= retained.length - 1} onClick={() => setLightbox(retained[Math.min(retained.length - 1, retained.findIndex((entry) => entry.summaryId === lightbox.summaryId) + 1)] ?? lightbox)}><ChevronRight size={16} /></button>
            </div>
            <button type="button" className="icon eod-shot-lightbox-close" aria-label="Close screenshot" autoFocus onClick={closeLightbox}><X size={16} /></button>
          </figure>
        </div>,
        document.body,
      )}
    </article>
  );
}
