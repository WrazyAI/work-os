/** The post-approval queue bubble. It is a presentational control: the owning
 * avatar state decides when it is visible and what opening the queue does. */
export function RecapQueueBubble({ onViewRecaps }: { onViewRecaps: () => void }) {
  return (
    <div className="avatar-prompt-bubble avatar-unapproved-bubble">
      <strong>You have unapproved recaps</strong>
      <span>Open the recaps tab to review them.</span>
      <button type="button" className="avatar-bubble-more" onClick={onViewRecaps}>View recaps</button>
    </div>
  );
}
