"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./EvidenceImageDialog.module.css";

export type EvidencePreview = {
  src: string;
  title: string;
  caption?: string | null;
};

/** The one image preview used by EOD evidence on both the employee and
 * administration surfaces. The image route is authenticated; a failed read
 * renders "Preview unavailable" instead of a broken image. */
export function evidenceScreenshotUrl(summaryId: string, size: "thumb" | "preview"): string {
  return `/api/work-os/evidence/screenshots/${encodeURIComponent(summaryId)}/preview?size=${size}`;
}

/** The small clickable frame. A denied or missing preview disappears rather
 * than leaving a broken image beside otherwise truthful evidence. */
export function EvidenceThumb({ thumbSrc, fullSrc, title, caption, label, onOpen }: {
  thumbSrc: string;
  fullSrc: string;
  title: string;
  caption?: string | null;
  label: string;
  onOpen: (preview: EvidencePreview) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <button
      type="button"
      className={styles.thumbButton}
      aria-label={label}
      onClick={() => onOpen({ src: fullSrc, title, caption })}
    >
      <img className={styles.thumb} src={thumbSrc} alt="" loading="lazy" onError={() => setFailed(true)} />
    </button>
  );
}

export default function EvidenceImageDialog({ preview, onClose }: { preview: EvidencePreview | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousRef = useRef<HTMLElement | null>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [preview?.src]);

  useEffect(() => {
    if (!preview) return;
    previousRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeHandler.current();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      previousRef.current?.focus();
    };
  }, [preview]);

  if (!preview || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={preview.title}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) closeHandler.current();
      }}
    >
      <div className={styles.dialog}>
        <header>
          <strong>{preview.title}</strong>
          <button ref={closeRef} type="button" className={styles.close} aria-label="Close image preview" onClick={() => closeHandler.current()}>
            <X size={16} aria-hidden />
          </button>
        </header>
        {failed ? (
          <p className={styles.unavailable}>Preview unavailable. The image is not available to this account.</p>
        ) : (
          <img src={preview.src} alt={preview.caption || preview.title} onError={() => setFailed(true)} />
        )}
        {preview.caption ? <p className={styles.caption}>{preview.caption}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

export { styles as evidenceImageStyles };
