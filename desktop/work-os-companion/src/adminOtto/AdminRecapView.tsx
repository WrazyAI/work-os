import { useEffect, useId, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import type { ReviewedRecap } from "../../../../src/modules/work-os/admin-otto/contracts";
import { RecapPrompter } from "../RecapPrompter";
import type { RecapSpeechLine } from "../recapSpeech";
import type { RecapSpeechSnapshot } from "../recapSpeechPlayer";
import { adminRecapReviewLine, adminRecapWindow, adminReviewStatusLabel } from "./labels";
import { safeAdminRecordHref } from "./recordLinks";

export type AdminRecapPlayback = Pick<RecapSpeechSnapshot, "status" | "lines" | "progress" | "activeIndex" | "slow" | "intervalId"> & {
  error?: string | null;
};

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/**
 * One reviewed recap, read-only.
 *
 * The labels and sections mirror the reviewed speech script: an amended recap
 * keeps the original AI summary beside the employee's correction, while a
 * confirmed recap never invents a correction. There is deliberately no
 * employee decision, attendance, timer or report action here.
 */
export function AdminRecapView({
  recap,
  onListen,
  onOpenRecord,
  playback = null,
  reducedMotion,
}: {
  recap: ReviewedRecap;
  onListen: (recap: ReviewedRecap) => void;
  onOpenRecord: (url: string) => void;
  playback?: AdminRecapPlayback | null;
  reducedMotion?: boolean;
}) {
  const headingScope = useId();
  const recordUrl = recap.recordUrl ? safeAdminRecordHref(recap.recordUrl) : null;
  const systemReduced = useReducedMotion();
  const reduced = reducedMotion ?? systemReduced;
  const amended = recap.reviewStatus === "amended";
  const isThisRecap = playback?.intervalId === recap.intervalId;
  const preparing = isThisRecap && playback?.status === "loading";
  const playing = isThisRecap && playback?.status === "playing";
  const finished = isThisRecap && playback?.status === "finished";
  const listening = preparing || playing;
  const spokenLines: RecapSpeechLine[] = playback?.lines?.length ? playback.lines : [];
  const speechError = playback?.error ?? null;
  const readingVisible = preparing || playing || (finished && spokenLines.length > 0);

  return (
    <article className="admin-otto-recap" aria-label={`Reviewed recap for ${recap.person.displayName}`}>
      <header className="admin-otto-recap-head">
        <div className="admin-otto-recap-title">
          <p className="admin-otto-recap-kicker">Reviewed recap</p>
          <h3>{recap.person.displayName}</h3>
          <p className="admin-otto-recap-when">
            <time dateTime={recap.windowStart}>{adminRecapWindow(recap)}</time>
            <span>, {recap.timezone}</span>
          </p>
        </div>
        <span className={`admin-otto-review-status is-${recap.reviewStatus}`}>
          {adminReviewStatusLabel(recap.reviewStatus)}
        </span>
      </header>

      <p className="admin-otto-recap-reviewed">
        Reviewed <time dateTime={recap.reviewedAt}>{adminRecapReviewLine(recap)}</time>
      </p>

      {readingVisible ? (
        <section className="admin-otto-reading" aria-label="Reading aloud">
          <div className="admin-otto-reading-head">
            <span>
              {finished
                ? "Read complete"
                : preparing
                  ? (playback?.slow ? "Taking longer than usual" : "Getting your recap…")
                  : "Otto is reading"}
            </span>
            {listening ? (
              <button
                type="button"
                className="admin-otto-listen is-listening"
                aria-label={preparing && playback?.slow ? "Cancel reading the recap" : `Stop reading the recap for ${recap.person.displayName}`}
                aria-pressed="true"
                onClick={() => onListen(recap)}
              >
                <Square size={12} aria-hidden="true" />
                {preparing && playback?.slow ? "Cancel" : "Stop"}
              </button>
            ) : null}
          </div>
          {spokenLines.length ? (
            <RecapPrompter
              lines={spokenLines}
              progress={playback?.progress ?? 0}
              activeIndex={playback?.activeIndex ?? 0}
              reduced={reduced}
              className="admin-otto-prompter"
            />
          ) : null}
        </section>
      ) : null}

      {speechError ? <p className="admin-otto-error" role="alert">{speechError}</p> : null}

      <section className="admin-otto-recap-section" aria-labelledby={`admin-recap-original-heading-${headingScope}`}>
        <h4 id={`admin-recap-original-heading-${headingScope}`}>{amended ? "Original recap" : "Reviewed recap"}</h4>
        {amended ? <p className="admin-otto-speech-marker">Original AI summary.</p> : null}
        {recap.original.headline ? <p className="admin-otto-recap-headline">{recap.original.headline}</p> : null}
        {recap.original.detail ? <p className="admin-otto-recap-detail">{recap.original.detail}</p> : null}
        {recap.original.activities.length ? (
          <ul className="admin-otto-recap-activities">
            {recap.original.activities.map((activity, index) => <li key={`${index}-${activity.slice(0, 24)}`}>{activity}</li>)}
          </ul>
        ) : null}
      </section>

      {amended ? (
        <section className="admin-otto-recap-section is-correction" aria-labelledby={`admin-recap-correction-heading-${headingScope}`}>
          <h4 id={`admin-recap-correction-heading-${headingScope}`}>Employee correction.</h4>
          {recap.employeeFeedback ? <p className="admin-otto-recap-detail">{recap.employeeFeedback}</p> : <p className="admin-otto-quiet">No correction text was recorded.</p>}
        </section>
      ) : null}

      <footer className="admin-otto-recap-footer">
        <p className="admin-otto-quiet">
          Reviewed by the employee. Observed activity is context, not task completion or attendance.
        </p>
        <div className="admin-otto-recap-actions">
          {!listening ? (
            <button
              type="button"
              className="admin-otto-listen"
              aria-label={finished ? `Listen again to the recap for ${recap.person.displayName}` : `Listen to the recap for ${recap.person.displayName}`}
              aria-pressed={false}
              onClick={() => onListen(recap)}
            >
              <Volume2 size={14} aria-hidden="true" />
              {finished ? "Listen again" : "Listen"}
            </button>
          ) : null}
          {recordUrl ? (
            <a
              className="admin-otto-record-link"
              href={recordUrl}
              onClick={(event) => { event.preventDefault(); onOpenRecord(recordUrl); }}
            >Open record</a>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
