import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock, X } from "lucide-react";
import { displayUpdateVersion } from "./updater";
import { useModalScrollLock } from "./modalScrollLock";
import { formatReleaseDate, type ChangelogHistoryEntry } from "./whatsNew";

const HISTORY_PAGE_SIZE = 20;

/** Read-only changelog history: every logged release, newest first, with the
 * running version tagged and the date it shipped. Twenty releases render per
 * page; Show more appends the next page until the end of the list. */
export function ChangelogHistory({ entries, visibleCount, onShowMore }: {
  entries: ChangelogHistoryEntry[];
  visibleCount: number;
  onShowMore: () => void;
}) {
  const visible = entries.slice(0, Math.max(HISTORY_PAGE_SIZE, visibleCount));
  const hidden = entries.length - visible.length;
  return (
    <div className="whats-new-history">
      {visible.map((entry) => (
        <section className="whats-new-release" key={entry.version}>
          <header>
            <h3>Version {displayUpdateVersion(entry.version)}</h3>
            {entry.date ? <time className="whats-new-date" dateTime={entry.date}>{formatReleaseDate(entry.date)}</time> : null}
            {entry.installed && <span className="whats-new-installed">This version</span>}
          </header>
          {entry.bullets.length > 0
            ? <ul className="whats-new-list">{entry.bullets.map((bullet, index) => <li key={`${entry.version}-${index}`}>{bullet}</li>)}</ul>
            : <p className="whats-new-empty">No notes were logged for this build.</p>}
        </section>
      ))}
      {hidden > 0 && (
        <button type="button" className="whats-new-show-all" onClick={onShowMore}>Show more</button>
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
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
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
          ? <ChangelogHistory entries={history} visibleCount={visibleCount} onShowMore={() => setVisibleCount((count) => count + HISTORY_PAGE_SIZE)} />
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
