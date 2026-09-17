import { X } from "lucide-react";

/* Read-only post-install changelog modal (design §§12, 19.8, 25.6): one
 * raised surface on the shared task-modal scrim, header/body/footer
 * regions, Esc/backdrop close and focus handling inherited from App's
 * modal plumbing. Bullets render as plain text. */

export function WhatsNewModal({ displayVersion, bullets, onClose }: {
  displayVersion: string;
  bullets: string[];
  onClose: () => void;
}) {
  return <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="task-modal whats-new-modal" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <header><div><span>What changed</span><h2 id="whats-new-title">Version {displayVersion}</h2></div><button aria-label="Close changelog" onClick={onClose}><X size={18} /></button></header>
      <div className="task-modal-body">
        {bullets.length > 0
          ? <ul className="whats-new-list">{bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>
          : <p className="whats-new-empty">No changelog notes shipped with this build.</p>}
      </div>
      <footer><button onClick={onClose}>Close</button></footer>
    </section>
  </div>;
}
