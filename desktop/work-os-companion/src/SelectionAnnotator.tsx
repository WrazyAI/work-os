import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { isAnnotationCommentValid, sanitizeComment, type PlanAnnotation } from "./planningAnnotations";

export type SelectionRect = { top: number; left: number; width: number; height: number; bottom: number };

function portal(node: React.ReactNode): React.ReactNode {
  // Fixed-position popovers must live outside transformed modal ancestors, or the
  // modal becomes their containing block and the anchor math renders offset.
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

export function rectFromElement(element: Element | null): SelectionRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom };
}

/** Anchors a fixed-position popover to a selection rect, clamped inside the viewport. */
function useFloatingPosition(anchor: SelectionRect | null, width: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ top: -9999, left: -9999, visibility: "hidden" });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !anchor || typeof window === "undefined") return;
    const margin = 12;
    const height = node.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(margin, Math.min(anchor.left + anchor.width / 2 - width / 2, viewportWidth - width - margin));
    const above = anchor.top - height - 10;
    const below = anchor.bottom + 10;
    const top = above >= margin ? above : Math.min(below, viewportHeight - height - margin);
    setStyle({ top, left, visibility: "visible" });
  }, [anchor?.top, anchor?.left, anchor?.width, anchor?.height, anchor?.bottom, width, anchor]);
  return { ref, style };
}
/** ChatGPT-style floating annotation composer anchored at the text selection. */
export function SelectionAnnotator({ quote, anchor, value, canSave, disabled = false, autoFocus = true, onChange, onSave, onCancel }: {
  quote: string;
  anchor: SelectionRect;
  value: string;
  canSave: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { ref, style } = useFloatingPosition(anchor, 344);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (autoFocus) textareaRef.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(96, Math.max(34, node.scrollHeight))}px`;
  }, [value]);
  const card = <div ref={ref} className="selection-annotator" style={style} role="dialog" aria-label="Add feedback on the highlighted text">
    <span className="selection-annotator-quote">“{quote.length > 96 ? `${quote.slice(0, 96)}…` : quote}”</span>
    <div className="selection-annotator-row">
      <textarea
        ref={textareaRef}
        rows={1}
        maxLength={1000}
        value={value}
        placeholder="What should change here?"
        aria-label="Feedback on the highlighted text"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSave && !disabled) onSave(); }
        }}
      />
      <button type="button" className="selection-annotator-save" aria-label="Add feedback" title="Add feedback (Enter)" disabled={disabled || !canSave} onClick={onSave}><Check size={15} /></button>
      <button type="button" className="selection-annotator-cancel" aria-label="Cancel feedback" title="Cancel (Esc)" onClick={onCancel}><X size={15} /></button>
    </div>
  </div>;
  return portal(card);
}

/** Floating review card for saved annotations; supports inline edit and delete. */
export function AnnotationPopover({ annotations, anchor, onEdit, onDelete, onClose }: {
  annotations: PlanAnnotation[];
  anchor: SelectionRect;
  onEdit: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { ref, style } = useFloatingPosition(anchor, 328);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".annotation-popover") && !event.target.closest(".planning-annotation-mark")) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);
  const card = <div ref={ref} className="annotation-popover" style={style} role="dialog" aria-label="Review annotation feedback">
    {annotations.map((annotation) => <div className="annotation-entry" key={annotation.id}>
      <span className="annotation-quote">“{annotation.quote.length > 110 ? `${annotation.quote.slice(0, 110)}…` : annotation.quote}”</span>
      {editingId === annotation.id
        ? <>
          <textarea autoFocus rows={2} maxLength={1000} value={draft} aria-label="Edit annotation feedback" onChange={(event) => setDraft(event.target.value)} />
          <div className="annotation-actions">
            <button type="button" className="primary" disabled={!isAnnotationCommentValid(draft)} onClick={() => { onEdit(annotation.id, sanitizeComment(draft)); setEditingId(null); }}><Check size={13} /> Save</button>
            <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
          </div>
        </>
        : <>
          <p className="annotation-comment">{annotation.comment}</p>
          <div className="annotation-actions">
            <button type="button" onClick={() => { setEditingId(annotation.id); setDraft(annotation.comment); }}><Pencil size={13} /> Edit</button>
            <button type="button" className="danger" onClick={() => onDelete(annotation.id)}><Trash2 size={13} /> Delete</button>
          </div>
        </>}
    </div>)}
  </div>;
  return portal(card);
}
