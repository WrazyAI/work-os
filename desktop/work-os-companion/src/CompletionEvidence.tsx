import { useId, useState } from "react";
import { Check, Download, FileText, Paperclip, X } from "lucide-react";
import { FadeArc } from "./LoadingUi";
import { formatWorkOsDateTime } from "./dateFormat";
import { safeTaskText } from "./taskWorkspace";
import {
  COMPLETION_EVIDENCE_ACCEPT,
  COMPLETION_EVIDENCE_MAX_BYTES,
  COMPLETION_EVIDENCE_MAX_NOTE,
  formatEvidenceFileSize,
  taskRequiresCompletionEvidence,
  validateCompletionEvidenceUpload,
  type TaskEvidenceRecord,
} from "../../../src/modules/work-os/completion-evidence";

export type TaskEvidenceDialogPhase = "idle" | "saving" | "failed" | "evidence_saved" | "done";

export type TaskEvidenceAttachResult = {
  outcome: "completed" | "attached" | "completion_failed";
  evidence: TaskEvidenceRecord;
  error?: string;
};

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error && value.message.trim() ? value.message : fallback;
}

function validateFile(file: File) {
  try {
    validateCompletionEvidenceUpload({ contentType: file.type, fileName: file.name, size: file.size, note: "" });
    return null;
  } catch (error) {
    return errorMessage(error, "This file cannot be attached.");
  }
}

/**
 * The completion step for an employee-owned task. Evidence is optional for a
 * simple task and required when the task records an expected outcome (the
 * same predicate the server enforces). The dialog never confirms completion
 * before the server does: an upload failure keeps the file and note for retry,
 * and a completion failure shows the saved evidence instead of a false success.
 */
export function TaskEvidenceDialog({
  task,
  mode = "complete",
  busy = false,
  initialPhase = "idle",
  initialError = null,
  initialEvidence = null,
  initialFileName = "",
  onAttach,
  onRetryCompletion,
  onCompleteWithoutEvidence,
  onCompleted,
  onClose,
}: {
  task: Record<string, any>;
  mode?: "complete" | "attach";
  busy?: boolean;
  initialPhase?: TaskEvidenceDialogPhase;
  initialError?: string | null;
  initialEvidence?: TaskEvidenceRecord | null;
  initialFileName?: string;
  onAttach: (file: File, note: string, idempotencyKey: string) => Promise<TaskEvidenceAttachResult>;
  onRetryCompletion?: (evidence: TaskEvidenceRecord) => Promise<{ completed: boolean; error?: string }>;
  onCompleteWithoutEvidence?: () => Promise<{ completed: boolean; error?: string }>;
  onCompleted?: (evidence: TaskEvidenceRecord | null) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [phase, setPhase] = useState<TaskEvidenceDialogPhase>(initialPhase);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState(initialFileName || initialEvidence?.fileName || "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [evidence, setEvidence] = useState<TaskEvidenceRecord | null>(initialEvidence);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const requiresEvidence = taskRequiresCompletionEvidence(task);
  const taskTitle = safeTaskText(task.title, "this task");
  const saving = busy || phase === "saving";
  const finished = phase === "done" || phase === "evidence_saved";

  const chooseFile = (next: File | null) => {
    if (!next) return;
    const problem = validateFile(next);
    setFileName(next.name);
    if (problem) {
      setFile(null);
      setError(problem);
      return;
    }
    setFile(next);
    setError(null);
    setPhase("idle");
    setIdempotencyKey(crypto.randomUUID());
  };

  const submit = async () => {
    if (!file || saving) return;
    try {
      validateCompletionEvidenceUpload({
        contentType: file.type,
        fileName: file.name,
        size: file.size,
        note,
      });
    } catch (validationError) {
      setError(errorMessage(validationError, "The evidence could not be saved."));
      return;
    }
    setPhase("saving");
    setError(null);
    try {
      const result = await onAttach(file, note, idempotencyKey);
      setEvidence(result.evidence);
      if (result.outcome === "completion_failed" || (mode === "complete" && result.outcome === "attached")) {
        setPhase("evidence_saved");
        setError(result.error ?? "Evidence saved, but the task is not complete yet.");
        return;
      }
      setPhase("done");
      onCompleted?.(result.evidence);
    } catch (attachError) {
      setPhase("failed");
      setError(errorMessage(attachError, "The evidence could not be saved. Check your connection and try again."));
    }
  };

  const retryCompletion = async () => {
    if (!evidence || !onRetryCompletion || saving) return;
    setPhase("saving");
    setError(null);
    try {
      const result = await onRetryCompletion(evidence);
      if (result.completed) {
        setPhase("done");
        onCompleted?.(evidence);
      } else {
        setPhase("evidence_saved");
        setError(result.error ?? "The task is still not complete. Try again.");
      }
    } catch (retryError) {
      setPhase("evidence_saved");
      setError(errorMessage(retryError, "The task is still not complete. Try again."));
    }
  };

  const completeWithoutEvidence = async () => {
    if (!onCompleteWithoutEvidence || saving) return;
    setPhase("saving");
    setError(null);
    try {
      const result = await onCompleteWithoutEvidence();
      if (result.completed) {
        setPhase("done");
        onCompleted?.(null);
      } else {
        setPhase("failed");
        setError(result.error ?? "The task could not be completed.");
      }
    } catch (completeError) {
      setPhase("failed");
      setError(errorMessage(completeError, "The task could not be completed."));
    }
  };

  const outcomeCopy = phase === "done"
    ? mode === "attach"
      ? "Evidence attached"
      : evidence
        ? "Task complete"
        : "Task complete without evidence"
    : phase === "evidence_saved" ? "Evidence saved" : null;
  const contextCopy = phase === "done"
    ? mode === "attach"
      ? "Evidence is attached to this task record."
      : evidence
        ? "The task and its evidence are recorded."
        : "The task is complete; no evidence was attached."
    : phase === "evidence_saved"
      ? "The file is saved, but the task is still open."
      : mode === "attach"
        ? "Attach a file to this task record."
        : requiresEvidence
          ? "This task records an expected outcome, so completion needs a file."
          : "Attach a file if it helps the record. This is optional.";

  return <div className="task-modal-backdrop completion-evidence-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onClose(); }}>
    <section className={`task-modal completion-evidence-modal${phase === "done" ? " is-done" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <header>
        <div>
          <span>{mode === "attach" ? "Completion evidence" : "Complete task"}</span>
          <h2 id={titleId}>{outcomeCopy ?? (mode === "attach" ? "Attach a file" : "Complete this task")}</h2>
        </div>
        <button aria-label="Close completion evidence" disabled={saving} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="task-modal-body completion-evidence-body">
        <p id={descriptionId} className="completion-evidence-task"><strong>{taskTitle}</strong><small>{contextCopy}</small></p>
        {requiresEvidence && typeof task.expected_outcome === "string" && task.expected_outcome.trim() ? <p className="completion-evidence-outcome"><span>Expected outcome</span>{task.expected_outcome.trim()}</p> : null}

        {finished && evidence ? <div className="completion-evidence-saved">
          <span className="completion-evidence-saved-icon" aria-hidden="true">{phase === "done" ? <Check size={18} /> : <FileText size={18} />}</span>
          <div><strong>{phase === "done" ? (mode === "attach" ? "Evidence attached" : "Evidence attached to this completed task") : "Evidence saved — task not complete yet"}</strong><small>{evidence.fileName} · {formatEvidenceFileSize(evidence.sizeBytes)} · Employee-attached</small>{evidence.note ? <p>{evidence.note}</p> : null}</div>
        </div> : null}

        {phase === "done" && !evidence ? <div className="completion-evidence-note"><Check size={17} aria-hidden="true" /><p>No evidence was attached. The task record shows that plainly.</p></div> : null}

        {!finished ? <>
          <div className="completion-evidence-field">
            <label htmlFor={`${titleId}-file`}>Completion evidence</label>
            <input
              id={`${titleId}-file`}
              type="file"
              accept={COMPLETION_EVIDENCE_ACCEPT}
              disabled={saving}
              autoFocus
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <small>One file · PNG, JPEG, WebP, PDF, text, Markdown, or CSV · up to {COMPLETION_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB.</small>
            {fileName ? <span className="completion-evidence-file-name"><Paperclip size={13} aria-hidden="true" />{fileName}</span> : null}
          </div>
          <div className="completion-evidence-field">
            <label htmlFor={`${titleId}-note`}>Note <em>optional</em></label>
            <textarea id={`${titleId}-note`} rows={3} maxLength={COMPLETION_EVIDENCE_MAX_NOTE} value={note} disabled={saving} placeholder="What does this file show?" onChange={(event) => { setNote(event.target.value); if (error && phase === "failed") { setError(null); setPhase("idle"); } }} />
            <small>{note.length}/{COMPLETION_EVIDENCE_MAX_NOTE}</small>
          </div>
          <p className="completion-evidence-provenance">Saved as employee-attached evidence. It is not a provider confirmation, and it never proves more than the file you chose.</p>
        </> : null}

        {error ? <p className="completion-evidence-error" role="alert">{error}</p> : null}
        {saving ? <p className="completion-evidence-status" role="status"><FadeArc size={14} /> {mode === "attach" ? "Saving evidence…" : "Saving evidence, then completing…"}</p> : null}
      </div>
      <footer>
        {phase === "done" ? <button className="primary" onClick={onClose}>Done</button> : phase === "evidence_saved" ? <>
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={saving} onClick={() => void retryCompletion()}>Retry completion</button>
        </> : <>
          <button disabled={saving} onClick={onClose}>Cancel</button>
          {mode === "complete" && !requiresEvidence && onCompleteWithoutEvidence ? <button disabled={saving} onClick={() => void completeWithoutEvidence()}>Complete without evidence</button> : null}
          <button className="primary" disabled={saving || !file} onClick={() => void submit()}>{saving ? <><FadeArc size={14} /> Saving…</> : phase === "failed" ? "Try again" : mode === "attach" ? "Attach evidence" : "Attach & complete"}</button>
        </>}
      </footer>
    </section>
  </div>;
}

/** The drawer's quiet evidence record. It names its provenance explicitly so
 * an employee file is never read as a screenshot or a provider confirmation. */
export function TaskEvidenceList({ evidence, readOnly = false, busy = false, completed = false, onAttach, onDownload }: {
  evidence: TaskEvidenceRecord[];
  readOnly?: boolean;
  busy?: boolean;
  completed?: boolean;
  onAttach?: () => void;
  onDownload?: (evidence: TaskEvidenceRecord) => void;
}) {
  return <section className="task-detail-evidence" aria-label="Completion evidence">
    <header>
      <div><strong>Completion evidence</strong><small>Employee-attached files and notes.</small></div>
      <span className="task-detail-evidence-count">{evidence.length}</span>
    </header>
    {evidence.length ? <div className="task-detail-evidence-list">{evidence.map((item) => <article key={item.id} className="task-detail-evidence-row">
      <span className="task-detail-evidence-icon" aria-hidden="true"><FileText size={15} /></span>
      <div className="task-detail-evidence-copy">
        <strong>{item.fileName}</strong>
        <small>{formatEvidenceFileSize(item.sizeBytes)} · Employee-attached · {formatWorkOsDateTime(item.createdAt, undefined, "Time unavailable")}</small>
        {item.note ? <p>{item.note}</p> : null}
      </div>
      {onDownload ? <button type="button" aria-label={`Download ${item.fileName}`} disabled={busy} onClick={() => onDownload(item)}><Download size={13} /> Download</button> : null}
    </article>)}</div> : <p className="task-detail-evidence-empty">{completed ? "No completion evidence was attached." : "No evidence attached yet."}</p>}
    {!readOnly && onAttach ? <button type="button" className="task-detail-evidence-attach" disabled={busy} onClick={onAttach}><Paperclip size={14} /> Attach evidence</button> : null}
  </section>;
}
