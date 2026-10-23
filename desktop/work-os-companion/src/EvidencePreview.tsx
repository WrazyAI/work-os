import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  ImageOff,
  X,
} from "lucide-react";
import { ChatMarkdown } from "./ChatMarkdown";
import { FadeArc } from "./LoadingUi";
import { formatWorkOsDateTime } from "./dateFormat";
import { renderViewportSurface } from "./viewportSurface";
import {
  completionEvidencePreviewKind,
  completionEvidenceTypeLabel,
  formatEvidenceFileSize,
  resolveCompletionEvidenceType,
  type CompletionEvidencePreviewKind,
  type TaskEvidenceRecord,
} from "../../../src/modules/work-os/completion-evidence";

/** The authenticated read is performed by the caller. The component never
 * receives a token, so an `<img>` or `<iframe>` can only use the short-lived
 * object URL created from the fetched blob. */
export type EvidenceLoader = (evidence: TaskEvidenceRecord) => Promise<Blob>;

const TEXT_PREVIEW_LIMIT = 200_000;

export type EvidencePreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "image"; url: string }
  | { status: "pdf"; url: string }
  | { status: "text"; text: string; truncated: boolean; markdown: boolean }
  | { status: "metadata" };

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error && value.message.trim() ? value.message : fallback;
}

function typeBadge(kind: CompletionEvidencePreviewKind, contentType: string, fileName: string) {
  const extension = (fileName.split(".").pop() ?? "").toUpperCase();
  switch (kind) {
    case "image": return extension && extension.length <= 4 ? extension : "IMG";
    case "pdf": return "PDF";
    case "word": return extension === "DOC" || extension === "DOCX" ? extension : "DOC";
    case "markdown": return "MD";
    case "text": return "TXT";
    case "spreadsheet": return "CSV";
    case "archive": return contentType === "application/x-7z-compressed" ? "7Z" : "ZIP";
    default: return "FILE";
  }
}

function tileIcon(kind: CompletionEvidencePreviewKind) {
  switch (kind) {
    case "image": return FileImage;
    case "pdf": return FileText;
    case "word": return FileType;
    case "markdown":
    case "text": return FileText;
    case "spreadsheet": return FileSpreadsheet;
    case "archive": return FileArchive;
    default: return FileText;
  }
}

/** A type tile is the stable thumbnail for every non-image file. The visible
 * extension badge keeps the type readable without relying on icon shape. */
export function EvidenceTypeTile({ kind, contentType = "", fileName = "", large = false, unavailable = false }: {
  kind: CompletionEvidencePreviewKind;
  contentType?: string;
  fileName?: string;
  large?: boolean;
  unavailable?: boolean;
}) {
  const Icon = unavailable ? ImageOff : tileIcon(kind);
  return <span className={`evidence-type-tile kind-${kind}${large ? " is-large" : ""}${unavailable ? " is-unavailable" : ""}`} aria-hidden="true">
    <Icon size={large ? 30 : 17} />
    <span>{unavailable ? "!" : typeBadge(kind, contentType, fileName)}</span>
  </span>;
}

/** Image thumbnails are fetched through the authenticated blob path, never a
 * tokenized URL. Loading, corrupt, and missing files all fall back to the type
 * tile instead of leaving a broken image in the drawer. */
export function EvidenceThumbnail({ evidence, loadEvidence, large = false }: {
  evidence: TaskEvidenceRecord;
  loadEvidence: EvidenceLoader;
  large?: boolean;
}) {
  const kind = completionEvidencePreviewKind(evidence.contentType);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loaderRef = useRef(loadEvidence);
  useEffect(() => { loaderRef.current = loadEvidence; }, [loadEvidence]);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (kind !== "image") return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void loaderRef.current(evidence).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        return;
      }
      setUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidence.id, evidence.url, kind]);

  if (kind === "image" && url) {
    return <span className={`evidence-thumb${large ? " is-large" : ""}`}>
      <img src={url} alt="" onError={() => { URL.revokeObjectURL(url); setUrl(null); setFailed(true); }} />
    </span>;
  }
  if (kind === "image" && failed) {
    return <EvidenceTypeTile kind={kind} contentType={evidence.contentType} fileName={evidence.fileName} large={large} unavailable />;
  }
  if (kind === "image") {
    return <span className={`evidence-thumb is-loading${large ? " is-large" : ""}`} aria-hidden="true" />;
  }
  return <EvidenceTypeTile kind={kind} contentType={evidence.contentType} fileName={evidence.fileName} large={large} />;
}

function useEvidencePreviewState(evidence: TaskEvidenceRecord, loadEvidence: EvidenceLoader) {
  const kind = completionEvidencePreviewKind(evidence.contentType);
  const needsFetch = kind === "image" || kind === "pdf" || kind === "text" || kind === "markdown" || kind === "spreadsheet";
  const [state, setState] = useState<EvidencePreviewState>(() => needsFetch ? { status: "loading" } : { status: "metadata" });
  const loaderRef = useRef(loadEvidence);
  useEffect(() => { loaderRef.current = loadEvidence; }, [loadEvidence]);

  useEffect(() => {
    if (!needsFetch) {
      setState({ status: "metadata" });
      return;
    }
    setState({ status: "loading" });
    let cancelled = false;
    let objectUrl: string | null = null;
    void loaderRef.current(evidence).then(async (blob) => {
      if (kind === "text" || kind === "markdown" || kind === "spreadsheet") {
        const truncated = blob.size > TEXT_PREVIEW_LIMIT;
        const text = await blob.slice(0, TEXT_PREVIEW_LIMIT).text();
        if (!cancelled) setState({ status: "text", text, truncated, markdown: kind === "markdown" });
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        return;
      }
      if (kind === "image") {
        // A truncated or fake image must fall into the same error state as a
        // missing file, not render a broken-image box.
        const url = objectUrl;
        const decoded = await new Promise<boolean>((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve(true);
          probe.onerror = () => resolve(false);
          probe.src = url;
        });
        if (cancelled) {
          URL.revokeObjectURL(url);
          objectUrl = null;
          return;
        }
        if (!decoded) {
          URL.revokeObjectURL(url);
          objectUrl = null;
          setState({ status: "error", message: "The image could not be decoded. The file may be corrupt." });
          return;
        }
      }
      setState(kind === "image" ? { status: "image", url: objectUrl } : { status: "pdf", url: objectUrl });
    }).catch((error) => {
      if (!cancelled) setState({ status: "error", message: errorMessage(error, "The file could not be loaded.") });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidence.id, evidence.url, kind, needsFetch]);

  return state;
}

function EvidenceMetadataPreview({ evidence }: { evidence: TaskEvidenceRecord }) {
  const kind = completionEvidencePreviewKind(evidence.contentType);
  const typeLabel = completionEvidenceTypeLabel(evidence.contentType);
  const copy = kind === "word"
    ? "Word documents open in their desktop app. This preview keeps the record readable and downloads the document without extracting it here."
    : kind === "archive"
      ? "Archives are not extracted in the app. Download the file to open its contents."
      : "This file has no in-app preview. Download it to open it in its native app.";
  return <div className="evidence-preview-metadata">
    <EvidenceTypeTile kind={kind} contentType={evidence.contentType} fileName={evidence.fileName} large />
    <div>
      <strong>{typeLabel}</strong>
      <p>{copy}</p>
      <dl>
        <div><dt>File name</dt><dd>{evidence.fileName}</dd></div>
        <div><dt>Type</dt><dd>{typeLabel}</dd></div>
        <div><dt>Size</dt><dd>{formatEvidenceFileSize(evidence.sizeBytes)}</dd></div>
        <div><dt>Attached</dt><dd>{evidence.createdAt ? formatWorkOsDateTime(evidence.createdAt, undefined, "Time unavailable") : "Time unavailable"}</dd></div>
        <div><dt>Provenance</dt><dd>Employee-attached</dd></div>
        {evidence.note ? <div><dt>Note</dt><dd>{evidence.note}</dd></div> : null}
      </dl>
    </div>
  </div>;
}

/** The preview body is exported separately from its async fetch so loading,
 * error, image, PDF, text, and metadata states have deterministic render
 * coverage without a live network or browser. */
export function EvidencePreviewBody({ evidence, state }: { evidence: TaskEvidenceRecord; state: EvidencePreviewState }) {
  if (state.status === "loading") {
    return <p className="evidence-preview-loading" role="status"><FadeArc size={15} /> Loading preview…</p>;
  }
  if (state.status === "error") {
    return <div className="evidence-preview-error" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <div>
        <strong>Preview unavailable</strong>
        <p>{state.message}</p>
        <small>The file may be corrupt or missing. Download it to open it in its native app.</small>
      </div>
    </div>;
  }
  if (state.status === "image") {
    return <img className="evidence-preview-image" src={state.url} alt={`Preview of ${evidence.fileName}`} />;
  }
  if (state.status === "pdf") {
    return <div className="evidence-preview-pdf">
      <iframe src={state.url} title={`PDF preview: ${evidence.fileName}`} tabIndex={-1} />
      <p>If the PDF does not appear, download it to open it in your PDF viewer.</p>
    </div>;
  }
  if (state.status === "text") {
    return <div className="evidence-preview-text">
      {state.markdown
        ? <div className="evidence-preview-markdown"><ChatMarkdown text={state.text} /></div>
        : <pre>{state.text}</pre>}
      {state.truncated ? <p className="evidence-preview-truncated">Preview truncated at 200 KB. Download the file to read all of it.</p> : null}
    </div>;
  }
  return <EvidenceMetadataPreview evidence={evidence} />;
}

export function EvidencePreviewDialog({ evidence, loadEvidence, onDownload, onClose }: {
  evidence: TaskEvidenceRecord;
  loadEvidence: EvidenceLoader;
  onDownload?: (evidence: TaskEvidenceRecord) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const state = useEvidencePreviewState(evidence, loadEvidence);
  const kind = completionEvidencePreviewKind(evidence.contentType);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const close = dialog.querySelector<HTMLElement>("[data-evidence-preview-close]");
      (close ?? dialog).focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
        .filter((element) => element === document.activeElement || element.getClientRects().length > 0);
      event.stopPropagation();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return renderViewportSurface(
    <div className="evidence-preview-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={dialogRef} className="evidence-preview-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <header>
          <div className="evidence-preview-heading">
            <EvidenceTypeTile kind={kind} contentType={evidence.contentType} fileName={evidence.fileName} />
            <div>
              <span>{completionEvidenceTypeLabel(evidence.contentType)} · Employee-attached</span>
              <h2 id={titleId}>{evidence.fileName}</h2>
            </div>
          </div>
          <button type="button" data-evidence-preview-close aria-label="Close evidence preview" onClick={onClose}><X size={18} /></button>
        </header>
        <p id={descriptionId} className="evidence-preview-provenance">The file is employee-attached completion evidence. It is not a provider confirmation and does not prove completion by itself.</p>
        <div className="evidence-preview-body">
          <EvidencePreviewBody evidence={evidence} state={state} />
        </div>
        <footer>
          <div className="evidence-preview-meta">
            <span>{formatEvidenceFileSize(evidence.sizeBytes)}</span>
            <span>{evidence.createdAt ? formatWorkOsDateTime(evidence.createdAt, undefined, "Time unavailable") : "Time unavailable"}</span>
            {evidence.note ? <span className="evidence-preview-note">{evidence.note}</span> : null}
          </div>
          {onDownload ? <button type="button" className="primary" onClick={() => onDownload(evidence)}><Download size={14} /> Download</button> : null}
        </footer>
      </section>
    </div>,
  );
}

/** The complete/attach dialog shows the chosen file before submit. Images use
 * a client-only object URL; every other type shows its type tile and metadata. */
export function EvidenceSelectionPreview({ file }: { file: File | null }) {
  const contentType = file ? resolveCompletionEvidenceType(file.type, file.name) ?? "" : "";
  const kind: CompletionEvidencePreviewKind = file ? completionEvidencePreviewKind(contentType) : "unsupported";
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!file || kind !== "image") return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => { URL.revokeObjectURL(objectUrl); };
  }, [file, kind]);

  if (!file) return null;
  return <div className="completion-evidence-selection" aria-label={`Selected file: ${file.name}`}>
    {kind === "image" && url && !failed
      ? <span className="evidence-thumb is-selection"><img src={url} alt="" onError={() => { URL.revokeObjectURL(url); setUrl(null); setFailed(true); }} /></span>
      : kind === "image" && failed
        ? <EvidenceTypeTile kind={kind} contentType={contentType} fileName={file.name} unavailable />
        : <EvidenceTypeTile kind={kind} contentType={contentType} fileName={file.name} />}
    <div>
      <strong>{file.name}</strong>
      <small>{completionEvidenceTypeLabel(contentType)} · {formatEvidenceFileSize(file.size)}</small>
    </div>
  </div>;
}
