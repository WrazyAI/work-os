import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock, X } from "lucide-react";
import { displayUpdateVersion } from "./updater";
import { useModalScrollLock } from "./modalScrollLock";
import type { ChangelogHistoryEntry } from "./whatsNew";

const HISTORY_PAGE_SIZE = 10;

/** Read-only changelog history: every logged release, newest first, with the
 * running version tagged. The first page is capped so the list stays scannable;
 * Show all reveals the rest. */
export function ChangelogHistory({ entries, showAll, onShowAll }: {
  entries: ChangelogHistoryEntry[];
  showAll: boolean;
  onShowAll: (value: boolean) => void;
}) {
  const visible = showAll ? entries : entries.slice(0, HISTORY_PAGE_SIZE);
  const hidden = entries.length - visible.length;
  return (
    <div className="whats-new-history">
      {visible.map((entry) => (
        <section className="whats-new-release" key={entry.version}>
          <header>
            <h3>Version {displayUpdateVersion(entry.version)}</h3>
            {entry.installed && <span className="whats-new-installed">This version</span>}
          </header>
          {entry.bullets.length > 0
            ? <ul className="whats-new-list">{entry.bullets.map((bullet, index) => <li key={`${entry.version}-${index}`}>{bullet}</li>)}</ul>
            : <p className="whats-new-empty">No notes were logged for this build.</p>}
        </section>
      ))}
      {hidden > 0 && (
        <button type="button" className="whats-new-show-all" onClick={() => onShowAll(true)}>Show all {entries.length} updates</button>
      )}
      {showAll && entries.length > HISTORY_PAGE_SIZE && (
        <button type="button" className="whats-new-show-all" onClick={() => onShowAll(false)}>Show {HISTORY_PAGE_SIZE} newest</button>
      )}
    </div>
  );
}

/* Read-only post-install changelog modal (design §§12, 19.8, 25.6): one
 * raised surface on the shared task-modal scrim, header/body/footer
 * regions, Esc/backdrop close and focus handling inherited from App's
 * modal plumbing. Bullets render as plain text. */
export function WhatsNewModal({ displayVersion, bullets, history = [], onClose }: {
  displayVersion: string;
  bullets: string[];
  history?: ChangelogHistoryEntry[];
  onClose: () => void;
}) {
  const [view, setView] = useState<"latest" | "history">("latest");
  const [showAll, setShowAll] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const olderCount = history.filter((entry) => !entry.installed).length;
  useModalScrollLock(true);

  useEffect(() => {
    if (view === "history") headingRef.current?.focus();
  }, [view]);

  return <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="task-modal whats-new-modal" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <header>
        <div>
          <span>{view === "history" ? "Changelog history" : "What changed"}</span>
          <h2 id="whats-new-title" ref={headingRef} tabIndex={-1}>
            {view === "history" ? `${history.length} logged update${history.length === 1 ? "" : "s"}` : `Version ${displayVersion}`}
          </h2>
        </div>
        <button aria-label="Close changelog" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="task-modal-body">
        {view === "history"
          ? <ChangelogHistory entries={history} showAll={showAll} onShowAll={setShowAll} />
          : bullets.length > 0
            ? <ul className="whats-new-list">{bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>
            : <p className="whats-new-empty">No changelog notes shipped with this build.</p>}
      </div>
      <footer>
        {view === "history"
          ? <button type="button" className="whats-new-older" onClick={() => setView("latest")}><ArrowLeft size={14} aria-hidden="true" /> Back to {displayVersion}</button>
          : olderCount > 0
            ? <button type="button" className="whats-new-older" onClick={() => setView("history")}><Clock size={14} aria-hidden="true" /> Check older updates</button>
            : null}
        <button onClick={onClose}>Close</button>
      </footer>
    </section>
  </div>;
}
