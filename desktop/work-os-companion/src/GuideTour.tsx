import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { PAGE_GUIDES } from "./guides";
import { guideFilmsFor } from "./guideFilms";
import GuideFilm, { clockLabel } from "./GuideFilm";
import PageGuideArt from "./PageGuideArt";
import { MASCOT } from "./mascot";
import { MascotMark } from "./chat/MascotMark";
import { ADMIN_GUIDE_VIEWS, EMPLOYEE_GUIDE_VIEWS, type GuideView } from "./guideState";

/**
 * The order the workspace is introduced in. My Day first because it is where a
 * workday starts and ends; Settings last because it is where you go once you
 * know what you want to change. The administration sequence follows the
 * section order the workspace itself uses.
 */
export const TOUR_PAGES: GuideView[] = [...EMPLOYEE_GUIDE_VIEWS];
export const ADMIN_TOUR_PAGES: GuideView[] = [...ADMIN_GUIDE_VIEWS];

/** "How My Day works" reads as "My Day" on a rail. */
const shortTitle = (view: GuideView) => PAGE_GUIDES[view].title.replace(/^How /, "").replace(/ works$/, "");

/**
 * The whole-workspace tour.
 *
 * Every page keeps its own guide, reachable from the `?` in its header. This is
 * the other entry point: the same films, played as one pass, at the moment the
 * workspace is new — or the administration sections, played the same way. The
 * step list is a prop so one component walks either workspace. Choosing a page
 * navigates the real application to it, so the tour is a walk through the
 * product rather than a carousel laid over it — and when it closes, the person
 * is standing on the last page it showed.
 *
 * It never advances on its own. Each page's clips play through and then it
 * waits, because moving someone to another screen unasked is the opposite of
 * guiding them. A page that was never filmed shows its drawn scene instead,
 * and the rail treats it exactly like a filmed chapter.
 */
export default function GuideTour({
  pages = TOUR_PAGES,
  subject = "your workspace",
  onNavigate,
  onClose,
}: {
  /** The pages this walk visits, in order. */
  pages?: GuideView[];
  /** Names the workspace the walk covers, e.g. "the administration workspace". */
  subject?: string;
  /** Called whenever the tour moves to another page, so the app can follow. */
  onNavigate: (view: GuideView) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [chapter, setChapter] = useState(0);
  const view = pages[page]!;
  const guide = PAGE_GUIDES[view];
  const films = guideFilmsFor(view);
  const last = page === pages.length - 1;

  // The application follows the tour.
  useEffect(() => { onNavigate(view); }, [onNavigate, view]);
  useEffect(() => { setChapter(0); }, [page]);

  const advance = useCallback(() => {
    setChapter((current) => (current + 1 < guide.steps.length ? current + 1 : current));
  }, [guide.steps.length]);

  const goTo = (index: number) => {
    if (index < 0 || index >= pages.length) return;
    setPage(index);
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
            <span>{MASCOT.name}&rsquo;s tour of {subject}</span>
            <h2 id="guide-tour-title">{guide.title}</h2>
            <p id="guide-tour-promise">{guide.promise}</p>
          </div>
          <button type="button" aria-label="Close the tour" title="Close the tour" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="task-modal-body guide-modal-body">
          {/* Where this page sits in the walk. Choosing one jumps the tour and
              takes the application with it. */}
          <ol className="guide-tour-rail" aria-label="Pages in this tour">
            {pages.map((step, index) => (
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

          {films.length > 0 ? (
            <GuideFilm
              view={view}
              film={films[chapter] ?? null}
              chapterKey={`${view}:${chapter}`}
              autoplay
              onEnded={advance}
            />
          ) : (
            <PageGuideArt view={view} activeStep={chapter} />
          )}

          <ol className="guide-steps">
            {guide.steps.map((step, index) => (
              <li key={step.title} className="guide-step">
                <button
                  type="button"
                  className="guide-step-control"
                  aria-controls="page-guide-art"
                  aria-pressed={chapter === index}
                  onClick={() => setChapter(index)}
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
            {pages.map((step, index) => <i key={step} className={index <= page ? "is-past" : ""} />)}
          </span>
          <button type="button" className="guide-quiet-action" onClick={onClose}>
            {last ? "Finish" : "Leave the tour here"}
          </button>
          {last ? (
            <button type="button" className="primary" onClick={onClose}>Got it</button>
          ) : (
            <button type="button" className="primary" onClick={() => goTo(page + 1)}>
              Next: {shortTitle(pages[page + 1]!)}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
