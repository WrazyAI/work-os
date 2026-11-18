import { X } from "lucide-react";
import { bubbleAction, type AvatarPromptKind, type BubbleActionKind } from "./avatarLogic";

/** The collapsed companion's prompt bubble. Tapping the copy opens the chat;
 * the bottom action goes straight to the prompt's destination — the EOD review
 * page or the SOD planning modal — instead of making the employee type first.
 * The corner control dismisses this prompt for the workday without hiding the
 * record behind it; the prompt re-arms on a genuinely new event. */
export function AvatarPromptBubble({
  kind,
  heading,
  compact,
  onOpen,
  onAction,
  onDismiss,
}: {
  kind: AvatarPromptKind;
  heading: string;
  compact: string;
  onOpen: () => void;
  onAction: (action: BubbleActionKind) => void;
  onDismiss?: () => void;
}) {
  const action = bubbleAction(kind);
  return (
    <div className={`avatar-prompt-bubble is-${kind}${onDismiss ? " has-dismiss" : ""}`}>
      {onDismiss ? (
        <button type="button" className="avatar-prompt-dismiss" aria-label="Dismiss reminder" title="Dismiss" onClick={onDismiss}>
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}
      <button type="button" className="avatar-prompt-open" onClick={onOpen}>
        <strong>{heading}</strong>
        <span>{compact}</span>
      </button>
      {action ? (
        <button type="button" className="avatar-prompt-action" onClick={() => onAction(action.kind)}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
