import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { PAGE_GUIDES } from "./guides";
import { guideFilmsFor } from "./guideFilms";
import GuideFilm, { clockLabel } from "./GuideFilm";
import { MASCOT } from "./mascot";
import { MascotMark } from "./chat/MascotMark";
import type { GuideView } from "./guideState";

/** Whether the employee has asked the system not to animate things at them. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * The one page-guide modal.
 *
 * It holds film of the real page, one clip per numbered step, and the steps are
 * its chapters. Opened for the first time it plays straight through — step one
 * runs, its clip ends, step two takes over — so a first visit is carried rather
 * than clicked at. Choosing a step jumps the film there, and arrow keys step
 * between chapters.
 *
 * Two things are deliberate:
 *
 *   - Hovering a step does not start it. Hover is how you read a list, not how
 *     you ask to watch six seconds of film; the old guide swapped its scene on
 *     hover, which made the list feel twitchy and made the illustration
 *     impossible to actually watch.
 *   - Nothing plays under reduced motion. The still frame and the step copy say
 *     everything the clip says, and a step can still be played on request.
 *
 * The app's modal layer supplies the focus trap, Escape handling, scroll lock,
 * and focus restore; every dismissal path is wired through the shared onClose.
 */
export default function PageGuide({
  view,
  autoOpen,
  developerPreview = false,
  onClose,
  onDisableAutoOpen,
  onStartTour,
}: {
  view: GuideView;
  autoOpen: boolean;
  developerPreview?: boolean;
  onClose: () => void;
  onDisableAutoOpen: () => void;
  /**
   * Present when the whole-workspace tour is still worth offering — the first
   * guide a new workspace shows is what invites it, so the walk-through is
   * something the employee chooses rather than something that happens to them.
   */
  onStartTour?: (() => void) | undefined;
}) {
  const guide = PAGE_GUIDES[view];
  const films = guideFilmsFor(view);
  const reduced = useReducedMotion();
  const [activeStep, setActiveStep] = useState(0);

  /** The film chapter for the selected step. A guide without film has no clip
   * to clamp to, so its drawn scene follows the step directly. */
  const chapter = films.length > 0 ? Math.min(activeStep, Math.max(0, films.length - 1)) : activeStep;

  /** The end of a clip hands over to the next step, so the guide plays itself. */
  const advance = useCallback(() => {
    setActiveStep((current) => (current + 1 < guide.steps.length ? current + 1 : current));
  }, [guide.steps.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const target = event.target as HTMLElement | null;
      // The step list is a set of buttons, so arrows are left to it unless the
      // reader is not in it.
      if (target?.closest(".guide-steps")) return;
      event.preventDefault();
      setActiveStep((current) => {
        const next = event.key === "ArrowRight" ? current + 1 : current - 1;
        return next < 0 || next >= guide.steps.length ? current : next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guide.steps.length]);

  return (
    <div
      className="task-modal-backdrop guide-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <section
        className="task-modal guide-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-guide-title"
        aria-describedby="page-guide-promise"
      >
        <header>
          <div className="guide-header-copy">
            {/* The guide is the same companion the employee just met in setup,
                so it speaks with his identity rather than a page icon. */}
            <MascotMark className="guide-mascot" />
            <span>{developerPreview ? "Developer preview" : `${MASCOT.name}’s page guide`}</span>
            <h2 id="page-guide-title">{guide.title}</h2>
            <p id="page-guide-promise">{guide.promise}</p>
          </div>
          <button type="button" aria-label="Close page guide" title="Close page guide" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="task-modal-body guide-modal-body">
          <GuideFilm
            view={view}
            film={films[chapter] ?? null}
            chapterKey={`${view}:${chapter}`}
            autoplay={!reduced}
            onEnded={advance}
          />
          <ol className="guide-steps">
            {guide.steps.map((step, index) => {
              const active = activeStep === index;
              const seconds = films[index]?.seconds;
              return (
                <li key={step.title} className="guide-step">
                  <button
                    type="button"
                    className="guide-step-control"
                    aria-controls="page-guide-art"
                    aria-pressed={active}
                    onClick={() => setActiveStep(index)}
                  >
                    <span className="guide-step-mark" aria-hidden="true"><step.icon size={15} strokeWidth={1.9} /></span>
                    <span className="guide-step-copy">
                      <strong>{index + 1}. {step.title}</strong>
                      <small>{step.body}</small>
                    </span>
                    {seconds ? <span className="guide-step-time" aria-hidden="true">{clockLabel(seconds)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <footer className="guide-modal-footer">
          {developerPreview ? (
            <small className="guide-auto-note">Guide state stays unchanged. Close this replay when you are done testing it.</small>
          ) : onStartTour ? (
            <button type="button" className="guide-quiet-action guide-tour-invite" onClick={onStartTour}>
              Show me the whole workspace
            </button>
          ) : autoOpen ? (
            <button type="button" className="guide-quiet-action" onClick={onDisableAutoOpen}>
              Don't show these automatically
            </button>
          ) : (
            <small className="guide-auto-note">Automatic guides are off. Open this one again from the ? in the header.</small>
          )}
          <button type="button" className="primary" onClick={onClose}>Got it</button>
        </footer>
      </section>
    </div>
  );
}
