import { X } from "lucide-react";
import { adminAttentionActionLabel, type AdminAttentionItem } from "./attention";

/** The collapsed Administration bubble. It is the admin counterpart of the
 * employee prompt bubble: one counted arrival, one direct destination, and one
 * corner control that silences it for the workday. */
export function AdminAttentionBubble({
  item,
  onOpen,
  onAction,
  onDismiss,
}: {
  item: AdminAttentionItem;
  onOpen: () => void;
  onAction: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`avatar-prompt-bubble avatar-admin-attention-bubble is-${item.kind} has-dismiss`} data-admin-attention={item.kind}>
      <button type="button" className="avatar-prompt-dismiss" aria-label="Dismiss admin reminder" title="Dismiss" onClick={onDismiss}>
        <X size={13} aria-hidden="true" />
      </button>
      <button type="button" className="avatar-prompt-open" onClick={onOpen}>
        <strong>{item.title}</strong>
        <span>{item.body}</span>
      </button>
      <button type="button" className="avatar-prompt-action" onClick={onAction}>
        {adminAttentionActionLabel(item)}
      </button>
    </div>
  );
}
