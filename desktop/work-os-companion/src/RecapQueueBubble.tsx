import { X } from "lucide-react";

/** The post-approval queue bubble. It is a presentational control: the owning
 * avatar state decides when it is visible and what opening the queue does. The
 * corner control dismisses this reminder for the workday; a genuinely new
 * recap re-arms it, and the recaps tab stays reachable. */
export function RecapQueueBubble({ onViewRecaps, onDismiss }: { onViewRecaps: () => void; onDismiss: () => void }) {
  return (
    <div className="avatar-prompt-bubble avatar-unapproved-bubble has-dismiss">
      <button type="button" className="avatar-prompt-dismiss" aria-label="Dismiss recap reminder" title="Dismiss" onClick={onDismiss}>
        <X size={13} aria-hidden="true" />
      </button>
      <strong>You have unapproved recaps</strong>
      <span>Open the recaps tab to review them.</span>
      <button type="button" className="avatar-bubble-more" onClick={onViewRecaps}>View recaps</button>
    </div>
  );
}
