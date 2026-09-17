import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { apiRequestBlob } from "./api";
import type { EodScreenshotGallery, EodScreenshotItem } from "./types";

const clock = (value: string) => value.slice(11, 16) || "—";
const altLabel = (item: EodScreenshotItem) => `Screenshot captured at ${clock(item.capturedAt)}${item.visibleApp ? ` in ${item.visibleApp}` : ""}`;

const blobUrls = new Map<string, Promise<string>>();
function screenshotUrl(summaryId: string, size: "thumb" | "preview" | "full") {
  const path = `/api/work-os/evidence/screenshots/${encodeURIComponent(summaryId)}/preview?size=${size}`;
  let pending = blobUrls.get(path);
  if (!pending) {
    pending = apiRequestBlob(path).then((blob) => URL.createObjectURL(blob)).catch((error) => {
      blobUrls.delete(path);
      throw error;
    });
    blobUrls.set(path, pending);
  }
  return pending;
}

export function ScreenshotImage({ summaryId, size, alt, className, srcOverride }: { summaryId: string; size: "thumb" | "preview" | "full"; alt: string; className?: string; srcOverride?: string | null }) {
  const [url, setUrl] = useState<string | null>(srcOverride ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (srcOverride) {
      setUrl(srcOverride);
      setFailed(false);
      return;
    }
    setUrl(null);
    setFailed(false);
    screenshotUrl(summaryId, size).then((value) => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [size, srcOverride, summaryId]);
  if (failed) return <span className={`eod-shot-unavailable ${className ?? ""}`}>Unavailable</span>;
  if (!url) return <span className={`eod-shot-skeleton ${className ?? ""}`} aria-hidden="true" />;
  return <img className={className} src={url} alt={alt} loading="lazy" onError={() => { setFailed(true); setUrl(null); }} />;
}

export type PreviewResolver = (summaryId: string, size: "thumb" | "preview" | "full") => string | null;

export function EodScreenshotPanel({ context, gallery, limit = 7, resolveSrc }: {
  context: { processed: number; observations: Array<{ summaryId: string; capturedAt: string; summary: string; visibleApp: string | null }> } | null;
  gallery: EodScreenshotGallery | null;
  limit?: number;
  resolveSrc?: PreviewResolver;
}) {
  const viewable = gallery?.viewable ?? [];
  const recent = viewable.slice(-limit);
  const moreCount = Math.max(0, viewable.length - recent.length);
  const processed = gallery?.processed ?? context?.processed ?? 0;
  const [gridOpen, setGridOpen] = useState(false);
  const [lightbox, setLightbox] = useState<EodScreenshotItem | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const openLightbox = useCallback((item: EodScreenshotItem, trigger?: HTMLElement | null) => {
    restoreFocusRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setGridOpen(false);
    setLightbox(item);
  }, []);
  const closeLightbox = useCallback(() => {
    setLightbox(null);
    restoreFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!gridOpen && !lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (lightbox) closeLightbox();
        else { setGridOpen(false); restoreFocusRef.current?.focus?.(); }
        return;
      }
      if (!lightbox || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      const index = viewable.findIndex((item) => item.summaryId === lightbox.summaryId);
      const next = event.key === "ArrowLeft" ? index - 1 : index + 1;
      if (next >= 0 && next < viewable.length) setLightbox(viewable[next] ?? null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeLightbox, gridOpen, lightbox, viewable]);

  const observationRows = context?.observations ?? recent.slice(-6).map((item) => ({ ...item }));
  const bySummaryId = new Map(viewable.map((item) => [item.summaryId, item]));
  const lightboxIndex = lightbox ? viewable.findIndex((item) => item.summaryId === lightbox.summaryId) : -1;
  const hasCounts = !!gallery && (gallery.excludedSensitive > 0 || gallery.excludedPolicy > 0 || gallery.unavailable > 0);

  return <>
    {observationRows.length > 0 && <ul className="eod-shot-rows">{observationRows.map((item, index) => {
      const frame = bySummaryId.get(item.summaryId);
      return <li key={`${item.capturedAt}:${index}`}>
        {frame
          ? <button type="button" className="eod-shot-row" onClick={(event) => openLightbox(frame, event.currentTarget)}>
              <ScreenshotImage summaryId={frame.summaryId} size="thumb" srcOverride={resolveSrc?.(frame.summaryId, "thumb")} alt={altLabel(frame)} className="eod-shot-thumb" />
              <span className="eod-shot-row-copy"><time>{clock(item.capturedAt)}</time><span>{item.visibleApp ? `${item.visibleApp} · ` : ""}{item.summary}</span></span>
            </button>
          : <span className="eod-shot-row-copy"><time>{clock(item.capturedAt)}</time><span>{item.visibleApp ? `${item.visibleApp} · ` : ""}{item.summary}</span></span>}
      </li>;
    })}</ul>}
    {recent.length > 0 && <div className="eod-shot-carousel" role="group" aria-label="Recent screenshots">
      {recent.map((item) => <button key={item.summaryId} type="button" className="eod-shot-tile" onClick={(event) => openLightbox(item, event.currentTarget)}>
        <ScreenshotImage summaryId={item.summaryId} size="thumb" srcOverride={resolveSrc?.(item.summaryId, "thumb")} alt={altLabel(item)} className="eod-shot-tile-image" />
        <time>{clock(item.capturedAt)}</time>
      </button>)}
      {moreCount > 0 && <button type="button" className="eod-shot-tile eod-shot-more" onClick={(event) => { restoreFocusRef.current = event.currentTarget; setGridOpen(true); }}>
        <strong>+{moreCount}</strong><span>more</span>
      </button>}
    </div>}
    <small className="eod-shot-breakdown">
      {processed} analyzed
      {gallery && gallery.pending > 0 ? ` · ${gallery.pending} still analyzing` : ""}
      {gallery && gallery.excludedSensitive > 0 ? ` · ${gallery.excludedSensitive} flagged as sensitive (images deleted)` : ""}
      {gallery && gallery.excludedPolicy > 0 ? ` · ${gallery.excludedPolicy} excluded by your exclusions` : ""}
      {gallery && gallery.unavailable > 0 ? ` · ${gallery.unavailable} unavailable` : ""}
    </small>
    {gridOpen && createPortal(
      <div className="eod-shot-modal" role="dialog" aria-modal="true" aria-label="All screenshots for this day" onPointerDown={(event) => { if (event.target === event.currentTarget) { setGridOpen(false); restoreFocusRef.current?.focus?.(); } }}>
        <div className="eod-shot-modal-panel">
          <header>
            <strong>{viewable.length} screenshot{viewable.length === 1 ? "" : "s"} this day</strong>
            <button type="button" className="icon" aria-label="Close screenshots" autoFocus onClick={() => { setGridOpen(false); restoreFocusRef.current?.focus?.(); }}><X size={16} /></button>
          </header>
          <div className="eod-shot-grid">
            {viewable.map((item) => <button key={item.summaryId} type="button" className="eod-shot-grid-item" onClick={(event) => openLightbox(item, event.currentTarget)}>
              <ScreenshotImage summaryId={item.summaryId} size="thumb" srcOverride={resolveSrc?.(item.summaryId, "thumb")} alt={altLabel(item)} className="eod-shot-grid-image" />
              <span><time>{clock(item.capturedAt)}</time>{item.visibleApp ? <small>{item.visibleApp}</small> : null}</span>
            </button>)}
          </div>
        </div>
      </div>,
      document.body,
    )}
    {lightbox && createPortal(
      <div className="eod-shot-lightbox" role="dialog" aria-modal="true" aria-label="Screenshot preview" onPointerDown={(event) => { if (event.target === event.currentTarget) closeLightbox(); }}>
        <figure>
          <ScreenshotImage summaryId={lightbox.summaryId} size="preview" srcOverride={resolveSrc?.(lightbox.summaryId, "preview")} alt={altLabel(lightbox)} className="eod-shot-lightbox-image" />
          <figcaption><time>{clock(lightbox.capturedAt)}</time>{lightbox.visibleApp ? ` · ${lightbox.visibleApp}` : ""}{lightbox.summary ? ` — ${lightbox.summary}` : ""}</figcaption>
          <div className="eod-shot-lightbox-nav">
            <button type="button" className="icon" aria-label="Previous screenshot" disabled={lightboxIndex <= 0} onClick={() => setLightbox(viewable[lightboxIndex - 1] ?? lightbox)}><ChevronLeft size={16} /></button>
            <button type="button" className="icon" aria-label="Next screenshot" disabled={lightboxIndex < 0 || lightboxIndex >= viewable.length - 1} onClick={() => setLightbox(viewable[lightboxIndex + 1] ?? lightbox)}><ChevronRight size={16} /></button>
          </div>
          <button type="button" className="icon eod-shot-lightbox-close" aria-label="Close screenshot" autoFocus onClick={closeLightbox}><X size={16} /></button>
        </figure>
      </div>,
      document.body,
    )}
  </>;
}
