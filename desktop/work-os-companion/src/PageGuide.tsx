import { X } from "lucide-react";
import { PAGE_GUIDES } from "./guides";
import { PageGuideArt } from "./PageGuideArt";
import type { GuideView } from "./guideState";

/**
 * The one page-guide modal. It shows a custom scene, at most three steps, and
 * exactly two ways out: `Got it`, or turning automatic guides off. The app's
 * modal layer supplies the focus trap, Escape handling, scroll lock, and focus
 * restore; this component only declares the dialog.
 */
export default function PageGuide({
  view,
  autoOpen,
  onClose,
  onDisableAutoOpen,
}: {
  view: GuideView;
  autoOpen: boolean;
  onClose: () => void;
  onDisableAutoOpen: () => void;
}) {
  const guide = PAGE_GUIDES[view];
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
          <div>
            <span>Page guide</span>
            <h2 id="page-guide-title">{guide.title}</h2>
            <p id="page-guide-promise">{guide.promise}</p>
          </div>
          <button type="button" aria-label="Close page guide" title="Close page guide" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="task-modal-body guide-modal-body">
          <PageGuideArt view={view} />
          <ol className="guide-steps">
            {guide.steps.map((step, index) => (
              <li key={step.title} className="guide-step">
                <span className="guide-step-mark" aria-hidden="true"><step.icon size={15} strokeWidth={1.9} /></span>
                <span className="guide-step-copy">
                  <strong>{index + 1}. {step.title}</strong>
                  <small>{step.body}</small>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <footer className="guide-modal-footer">
          {autoOpen ? (
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
