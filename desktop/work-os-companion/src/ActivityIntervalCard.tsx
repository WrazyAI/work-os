import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ScreenshotImage, type PreviewResolver } from "./ScreenshotGallery";
import { useModalScrollLock } from "./modalScrollLock";
import type { ActivityInterval, ActivityIntervalCard as ActivityIntervalCardData, ActivityIntervalEvidence } from "./types";

/** The Tasks stream sends the full record; the prompt turn sends the compact
 * card from `/ensure` (no evidence list). One component renders both. */
type ActivityIntervalModel = ActivityIntervalCardData & Partial<Pick<ActivityInterval, "evidence" | "evidenceExpired" | "evidenceCount">>;

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

interface ActivityIntervalCardProps {
  interval: ActivityIntervalModel;
  timezone?: string | null;
  currentDate?: string | null;
  onDecide?: (id: string, action: "confirm" | "amend", feedback?: string) => Promise<void>;
  deciding?: boolean;
  defaultEvidenceOpen?: boolean;
  resolveSrc?: PreviewResolver;
  /** Chat-bubble presentation: a lead-in line ("This is what we got from your
   * last hour") and an Edit action that hands editing to the composer instead
   * of expanding an inline field. */
  leadIn?: string;
  onEdit?: () => void;
}

/** One Activity Interval Review card: headline, evidence-bounded detail,
 * provenance chip, confirm/amend actions, and the exact analyzed frames behind
 * a collapsed disclosure. Looks like a chat card, not a dashboard tile. */
export function ActivityIntervalCard({
  interval,
  timezone,
  currentDate,
  onDecide,
  deciding = false,
  defaultEvidenceOpen = false,
  resolveSrc,
  leadIn,
  onEdit,
}: ActivityIntervalCardProps) {
  const [feedback, setFeedback] = useState("");
  const [amending, setAmending] = useState(false);
  const [lightbox, setLightbox] = useState<ActivityIntervalEvidence | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useModalScrollLock(lightbox !== null);

  const evidence = useMemo(() => (interval.evidence ?? []).filter((entry) => entry.usedInModel), [interval.evidence]);
  const retained = evidence.filter((entry) => entry.summaryId && entry.retained);
  const evidenceExpired = interval.evidenceExpired === true || retained.length < evidence.length;
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
      {leadIn ? <p className="chat-activity-lead">{leadIn}</p> : null}
      {interval.headline ? <p className="chat-activity-headline">{interval.headline}</p> : null}
      {interval.detail ? <p className="chat-activity-detail">{interval.detail}</p> : null}
      {interval.reviewStatus === "amended" && interval.employeeFeedback ? (
        <p className="chat-activity-note"><strong>Your note:</strong> {interval.employeeFeedback}</p>
      ) : null}
      {interval.reviewStatus === "inferred" ? (
        <p className="chat-activity-provenance">Inferred from your screenshots — add or correct anything missing.</p>
      ) : null}

      {interval.reviewStatus === "inferred" && onDecide ? (
        onEdit ? (
          <>
            <p className="chat-activity-ask">Sounds good?</p>
            <div className="chat-activity-actions">
              <button type="button" className="chat-activity-confirm" disabled={deciding} onClick={() => void onDecide(interval.id, "confirm")}>
                {deciding ? "Saving…" : "Looks good"}
              </button>
              <button type="button" className="chat-activity-quiet" disabled={deciding} onClick={onEdit}>Edit</button>
            </div>
          </>
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
            <button type="button" className="chat-activity-confirm" disabled={deciding} onClick={() => void onDecide(interval.id, "confirm")}>
              {deciding ? "Saving…" : "Looks right"}
            </button>
            <button type="button" className="chat-activity-quiet" disabled={deciding} onClick={() => setAmending(true)}>Add or correct</button>
          </div>
        )
      ) : null}

      {evidence.length > 0 ? (
        <details className="chat-activity-evidence" open={defaultEvidenceOpen}>
          <summary>Evidence · {evidence.length} screenshot{evidence.length === 1 ? "" : "s"}</summary>
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
          {evidenceExpired ? (
            <small className="chat-activity-expired">
              {retained.length > 0
                ? "Some screenshots expired under the 30-day retention policy."
                : "Screenshots expired under the 30-day retention policy. The recap text is kept."}
            </small>
          ) : null}
        </details>
      ) : interval.evidenceExpired ? (
        <small className="chat-activity-expired">Screenshots expired under the 30-day retention policy. The recap text is kept.</small>
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
