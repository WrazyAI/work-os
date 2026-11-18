import { ArrowUpRight, X } from "lucide-react";
import { adminAttentionActionLabel, type AdminAttentionItem } from "./attention";

/** The expanded Administration card. It sits above the thread or the inbox and
 * never takes the tab, the reader, or the scroll position away from the person. */
export function AdminAttentionCard({
  item,
  onAction,
  onDismiss,
}: {
  item: AdminAttentionItem;
  onAction: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className={`admin-otto-attention is-${item.kind}`} aria-label={item.title} role="status" data-admin-attention-card={item.kind}>
      <div className="admin-otto-attention-copy">
        <strong>{item.title}</strong>
        <p>{item.body}</p>
      </div>
      <div className="admin-otto-attention-actions">
        <button type="button" className="admin-otto-secondary" onClick={onAction}>
          {adminAttentionActionLabel(item)}
          <ArrowUpRight size={13} aria-hidden="true" />
        </button>
        <button type="button" className="admin-otto-attention-dismiss" aria-label="Dismiss admin reminder" title="Dismiss" onClick={onDismiss}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
