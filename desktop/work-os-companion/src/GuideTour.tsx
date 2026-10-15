import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { PAGE_GUIDES } from "./guides";
import { GUIDE_FILMS } from "./guideFilms";
import GuideFilm, { clockLabel, nextGuideChapter } from "./GuideFilm";
import { MASCOT } from "./mascot";
import { MascotMark } from "./chat/MascotMark";
import type { GuideView } from "./guideState";

/**
 * The order the workspace is introduced in. My Day first because it is where a
 * workday starts and ends; Settings last because it is where you go once you
 * know what you want to change.
 */
export const TOUR_PAGES: GuideView[] = ["day", "tasks", "review", "insights", "settings"];

/** Keep page and chapter together so a page jump never briefly shows its old chapter. */
export interface TourPosition { page: number; chapter: number; }

export function navigateTour(position: TourPosition, targetPage: number): TourPosition {
  if (!Number.isInteger(targetPage) || targetPage < 0 || targetPage >= TOUR_PAGES.length) return position;
  return targetPage === position.page ? position : { page: targetPage, chapter: 0 };
}

/** "How My Day works" reads as "My Day" on a rail. */
const shortTitle = (view: GuideView) => PAGE_GUIDES[view].title.replace(/^How /, "").replace(/ works$/, "");

/**
 * The whole-workspace tour.
 *
 * Every page keeps its own guide, reachable from the `?` in its header. This is
 * the other entry point: the same five films, played as one pass, at the moment
 * the workspace is new. Choosing a page navigates the real application to it, so
 * the tour is a walk through the product rather than a carousel laid over it —
 * and when it closes, the employee is standing on the last page it showed.
 *
 * It never advances on its own. Each page's clips play through and then it
 * waits, because moving someone to another screen unasked is the opposite of
 * guiding them.
 */
export default function GuideTour({
  onNavigate,
  onClose,
}: {
  /** Called whenever the tour moves to another page, so the app can follow. */
  onNavigate: (view: GuideView) => void;
  onClose: () => void;
}) {
  const [{ page, chapter }, setPosition] = useState<TourPosition>({ page: 0, chapter: 0 });
  const view = TOUR_PAGES[page]!;
  const guide = PAGE_GUIDES[view];
  const films = GUIDE_FILMS[view] ?? [];
  const last = page === TOUR_PAGES.length - 1;

  // The application follows the tour.
  useEffect(() => { onNavigate(view); }, [onNavigate, view]);

  const advance = useCallback(() => {
    setPosition((current) => {
      const count = PAGE_GUIDES[TOUR_PAGES[current.page]!].steps.length;
      const next = nextGuideChapter(current.chapter, count);
      return next === current.chapter ? current : { ...current, chapter: next };
    });
  }, []);

  const goTo = (index: number) => {
    setPosition((current) => navigateTour(current, index));
  };

  return (
    <div
      className="task-modal-backdrop guide-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <section
        className="task-modal guide-modal guide-tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-tour-title"
        aria-describedby="guide-tour-promise"
      >
        <header>
          <div className="guide-header-copy">
            <MascotMark className="guide-mascot" />
            <span>{MASCOT.name}&rsquo;s tour of your workspace</span>
            <h2 id="guide-tour-title">{guide.title}</h2>
            <p id="guide-tour-promise">{guide.promise}</p>
          </div>
          <button type="button" aria-label="Close the tour" title="Close the tour" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="task-modal-body guide-modal-body">
          {/* Where this page sits in the walk. Choosing one jumps the tour and
              takes the application with it. */}
          <ol className="guide-tour-rail" aria-label="Pages in this tour">
            {TOUR_PAGES.map((step, index) => (
              <li key={step}>
                <button
                  type="button"
                  className={index === page ? "is-current" : index < page ? "is-done" : ""}
                  aria-current={index === page ? "step" : undefined}
                  onClick={() => goTo(index)}
                >
                  <span aria-hidden="true">{index < page ? <Check size={11} strokeWidth={3} /> : index + 1}</span>
                  {shortTitle(step)}
                </button>
              </li>
            ))}
          </ol>

          <GuideFilm
            view={view}
            film={films[chapter] ?? null}
            chapterKey={`${view}:${chapter}`}
            autoplay
            onEnded={advance}
          />

          <ol className="guide-steps">
            {guide.steps.map((step, index) => (
              <li key={step.title} className="guide-step">
                <button
                  type="button"
                  className="guide-step-control"
                  aria-controls="page-guide-art"
                  aria-pressed={chapter === index}
                  onClick={() => setPosition((current) => current.chapter === index ? current : { ...current, chapter: index })}
                >
                  <span className="guide-step-mark" aria-hidden="true"><step.icon size={15} strokeWidth={1.9} /></span>
                  <span className="guide-step-copy">
                    <strong>{index + 1}. {step.title}</strong>
                    <small>{step.body}</small>
                  </span>
                  {films[index]?.seconds ? <span className="guide-step-time" aria-hidden="true">{clockLabel(films[index]!.seconds)}</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </div>

        <footer className="guide-modal-footer guide-tour-footer">
          <span className="guide-tour-track" aria-hidden="true">
            {TOUR_PAGES.map((step, index) => <i key={step} className={index <= page ? "is-past" : ""} />)}
          </span>
          <button type="button" className="guide-quiet-action" onClick={onClose}>
            {last ? "Finish" : "Leave the tour here"}
          </button>
          {last ? (
            <button type="button" className="primary" onClick={onClose}>Got it</button>
          ) : (
            <button type="button" className="primary" onClick={() => goTo(page + 1)}>
              Next: {shortTitle(TOUR_PAGES[page + 1]!)}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
