import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { PAGE_GUIDES } from "./guides";
import { PageGuideArt } from "./PageGuideArt";
import { MascotMark } from "./chat/MascotMark";
import type { GuideView } from "./guideState";

/**
 * The one page-guide modal. Its illustration plays one short, bounded sequence
 * on entry, then each numbered step can drive the scene directly. The app's
 * modal layer supplies the focus trap, Escape handling, scroll lock, and focus
 * restore; every dismissal path is wired through the shared onClose callback.
 */
export default function PageGuide({
  view,
  autoOpen,
  developerPreview = false,
  onClose,
  onDisableAutoOpen,
}: {
  view: GuideView;
  autoOpen: boolean;
  developerPreview?: boolean;
  onClose: () => void;
  onDisableAutoOpen: () => void;
}) {
  const guide = PAGE_GUIDES[view];
  const [activeStep, setActiveStep] = useState(0);
  const interactedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers = guide.steps.slice(1).map((_, index) => window.setTimeout(() => {
      if (!interactedRef.current) setActiveStep(index + 1);
    }, (index + 1) * 900));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [guide.steps.length, view]);

  const activateStep = (index: number) => {
    interactedRef.current = true;
    setActiveStep(index);
  };

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
            <span>{developerPreview ? "Developer preview" : "Page guide"}</span>
            <h2 id="page-guide-title">{guide.title}</h2>
            <p id="page-guide-promise">{guide.promise}</p>
          </div>
          <button type="button" aria-label="Close page guide" title="Close page guide" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="task-modal-body guide-modal-body">
          <PageGuideArt view={view} activeStep={activeStep} />
          <ol className="guide-steps">
            {guide.steps.map((step, index) => {
              const active = activeStep === index;
              return (
                <li key={step.title} className="guide-step">
                  <button
                    type="button"
                    className="guide-step-control"
                    aria-controls="page-guide-art"
                    aria-pressed={active}
                    onMouseEnter={() => activateStep(index)}
                    onFocus={() => activateStep(index)}
                    onClick={() => activateStep(index)}
                  >
                    <span className="guide-step-mark" aria-hidden="true"><step.icon size={15} strokeWidth={1.9} /></span>
                    <span className="guide-step-copy">
                      <strong>{index + 1}. {step.title}</strong>
                      <small>{step.body}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <footer className="guide-modal-footer">
          {developerPreview ? (
            <small className="guide-auto-note">Guide state stays unchanged. Close this replay when you are done testing it.</small>
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
