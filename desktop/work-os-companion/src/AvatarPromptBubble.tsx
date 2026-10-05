import { bubbleAction, type AvatarPromptKind, type BubbleActionKind } from "./avatarLogic";

/** The collapsed companion's prompt bubble. Tapping the copy opens the chat;
 * the bottom action goes straight to the prompt's destination — the EOD review
 * page or the SOD planning modal — instead of making the employee type first. */
export function AvatarPromptBubble({
  kind,
  heading,
  compact,
  onOpen,
  onAction,
}: {
  kind: AvatarPromptKind;
  heading: string;
  compact: string;
  onOpen: () => void;
  onAction: (action: BubbleActionKind) => void;
}) {
  const action = bubbleAction(kind);
  return (
    <div className={`avatar-prompt-bubble is-${kind}`}>
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
