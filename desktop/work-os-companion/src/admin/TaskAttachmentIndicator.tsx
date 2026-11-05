import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon } from "lucide-react";
import type { TaskEvidenceRecord } from "../../../../src/modules/work-os/completion-evidence";

/** Files and images are the two attachment classes the admin row needs to
 * distinguish. A PDF, doc, archive, or note is a file; only image content
 * types count as images. */
export function attachmentCounts(attachments: TaskEvidenceRecord[]) {
  const images = attachments.filter((item) => item.contentType.trim().toLowerCase().startsWith("image/")).length;
  return { total: attachments.length, images, files: attachments.length - images };
}

export function attachmentSummary(attachments: TaskEvidenceRecord[]) {
  const { total, images, files } = attachmentCounts(attachments);
  if (!total) return "";
  const parts = [
    files ? `${files} file${files === 1 ? "" : "s"}` : null,
    images ? `${images} image${images === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return `${parts.join(" and ")} attached`;
}

type Placement = "above" | "below";

/** A quiet stack of slanted attachment cards beside a task's status. The
 * tooltip is fixed to the viewport so the table's horizontal scroller can
 * never clip it; hover, focus, and a tap all reveal the same count sentence. */
export function TaskAttachmentIndicator({ attachments }: { attachments: TaskEvidenceRecord[] }) {
  const id = useId();
  const root = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; placement: Placement }>({ left: 0, top: 0, placement: "above" });
  const summary = attachmentSummary(attachments);
  const { total, images, files } = attachmentCounts(attachments);

  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [open]);

  if (!total) return null;

  const reveal = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const above = rect.top > 72;
    const width = 220;
    setPosition({
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)),
      top: above ? rect.top - 8 : rect.bottom + 8,
      placement: above ? "above" : "below",
    });
    setOpen(true);
  };

  return <>
    <button
      ref={root}
      type="button"
      className="admin-attachment-stack"
      aria-label={summary}
      aria-expanded={open}
      aria-describedby={open ? id : undefined}
      onPointerEnter={(event) => reveal(event.currentTarget)}
      onPointerLeave={() => setOpen(false)}
      onFocus={(event) => reveal(event.currentTarget)}
      onBlur={() => setOpen(false)}
      onClick={(event) => { event.stopPropagation(); reveal(event.currentTarget); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          reveal(event.currentTarget);
        }
      }}
    >
      <span className="admin-attachment-card is-back" aria-hidden="true">{files ? <FileText size={10} /> : <ImageIcon size={10} />}</span>
      <span className="admin-attachment-card is-front" aria-hidden="true">{images ? <ImageIcon size={10} /> : <FileText size={10} />}</span>
      {total > 2 ? <span className="admin-attachment-more" aria-hidden="true">+{total - 2}</span> : null}
    </button>
    {open && typeof document !== "undefined" ? createPortal(
      <span id={id} role="tooltip" className={`admin-attachment-tooltip is-${position.placement}`} style={{ left: position.left, top: position.top }}>{summary}</span>,
      document.body,
    ) : null}
  </>;
}
