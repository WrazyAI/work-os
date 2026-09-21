import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CheckCircle2, Pencil, Sparkles, Trash2, Video, X } from "lucide-react";
import type { DailyPlan } from "./types";
import { AnnotationPopover, SelectionAnnotator, rectFromElement, type SelectionRect } from "./SelectionAnnotator";
import { FadeArc, Wave } from "./LoadingUi";
import { formatWorkOsDate } from "./dateFormat";
import { useModalScrollLock } from "./modalScrollLock";
import {
  annotationsForTarget,
  annotatedTextSegments,
  applyEditsToCommitments,
  countAnnotationsForCommitment,
  diffEditedCommitments,
  isAnnotationCommentValid,
  isAnnotationRangeValid,
  parseCriteriaLines,
  sanitizeComment,
  sanitizeQuote,
  type PlanAnnotation,
  type PlanDraftEdit,
} from "./planningAnnotations";

export type PlanningSessionState = "idle" | "drafting" | "interpreting" | "refining" | "clarifying" | "reviewing" | "saving" | "saved" | "confirmed" | "offline_fallback" | "ai_unavailable" | "save_error" | "conflict";
export const LOOM_ONLY_PLAN_INTENT = "Use the attached Loom recording to build today's plan.";
export type PlanningInterpretation = {
  buildId?: string;
  rawIntent: string;
  summary: string;
  commitments: Array<{ clientId: string; linkedTaskId?: string; title: string; objective: string; successCriteria: string[]; dependency?: string; blocker?: string; estimatedMinutes?: number; sourceRefs: Array<{ provider: string; type: string; id: string; label?: string }>; confidence: number }>;
  clarifications: Array<{ id: string; commitmentId?: string; question: string; reason: string }>;
  readiness: "ready" | "needs_one_clarification" | "needs_multiple_clarifications";
};

export type EditedCommitmentFields = { title: string; objective: string; successCriteria: string[] };

/** Renders only the exact selected ranges, including repeated phrases. */
function annotatedNodes(text: string, target: string, annotations: PlanAnnotation[], keyPrefix: string, onOpen?: (ids: string[], element: Element) => void): ReactNode[] {
  return annotatedTextSegments(text, annotations, target).map((segment, index) => segment.annotationCount
    ? <mark
      key={`${keyPrefix}-${index}`}
      className="planning-annotation-mark"
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      title={onOpen ? "Review annotation feedback" : undefined}
      onClick={onOpen ? (event) => { event.stopPropagation(); onOpen(segment.annotationIds, event.currentTarget); } : undefined}
      onKeyDown={onOpen ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(segment.annotationIds, event.currentTarget); } } : undefined}
    >{segment.text}</mark>
    : segment.text);
}

function PlanningDocumentText({
  className,
  target,
  value,
  annotations,
  editing,
  label,
  maxLength,
  onOpenAnnotation,
  onDocumentInput,
  onChange,
}: {
  className: string;
  target: string;
  value: string;
  annotations: PlanAnnotation[];
  editing: boolean;
  label: string;
  maxLength: number;
  onOpenAnnotation?: (ids: string[], element: Element) => void;
  onDocumentInput?: () => void;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (editing && ref.current && ref.current.textContent !== value) ref.current.textContent = value;
  }, [editing, value]);
  return <div
    ref={ref}
    className={className}
    data-annotate-target={target}
    contentEditable={editing}
    suppressContentEditableWarning
    role={editing ? "textbox" : undefined}
    aria-label={label}
    aria-multiline={editing || undefined}
    spellCheck={editing}
    onInput={(event) => {
      const next = event.currentTarget.textContent ?? "";
      if (next.length > maxLength) {
        event.currentTarget.textContent = value;
        return;
      }
      onDocumentInput?.();
      onChange(next);
    }}
  >{editing ? value : annotatedNodes(value, target, annotations, target, onOpenAnnotation)}</div>;
}

export function PlanningSession({
  open,
  plan,
  active,
  busy,
  onClose,
  onInterpret,
  onRefine,
  onConfirm,
  loomEnabled = false,
  onLoomPreview,
  lateReasonRequired = false,
  onSaveLateReason,
}: {
  open: boolean;
  plan: DailyPlan | null;
  active: boolean;
  busy: boolean;
  onClose: () => void;
  onInterpret: (input: string, loom?: { url: string; transcript?: string }) => Promise<PlanningInterpretation>;
  onRefine: (input: string, draft: PlanningInterpretation, annotations: PlanAnnotation[], edits: PlanDraftEdit[]) => Promise<PlanningInterpretation>;
  onConfirm: (input: string, interpretation: PlanningInterpretation | null, clarificationAnswers: Record<string, string>) => Promise<"confirmed" | "saved" | "queued" | "conflict" | "failed" | "rebuild">;
  /** True while this workday started 30+ minutes late with no recorded reason. */
  lateReasonRequired?: boolean;
  onSaveLateReason?: (reason: string) => Promise<void>;
  /** Loom analysis for the day's plan, opt-in per organization. */
  loomEnabled?: boolean;
  onLoomPreview?: (url: string) => Promise<{ title: string | null; durationSeconds: number | null; createdLocalDate: string | null; verdict: string; usableForDay: boolean; metadataAvailable: boolean } | null>;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<PlanningSessionState>("idle");
  const [loomOpen, setLoomOpen] = useState(false);
  const [loomUrl, setLoomUrl] = useState("");
  const [loomTranscript, setLoomTranscript] = useState("");
  const [loomReading, setLoomReading] = useState(false);
  const [loomError, setLoomError] = useState("");
  const [loomReadback, setLoomReadback] = useState<{ title: string | null; durationSeconds: number | null; createdLocalDate: string | null; verdict: string; usableForDay: boolean; metadataAvailable: boolean } | null>(null);
  const [interpretation, setInterpretation] = useState<PlanningInterpretation | null>(null);
  const [builtIntent, setBuiltIntent] = useState("");
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [annotations, setAnnotations] = useState<PlanAnnotation[]>([]);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [edited, setEdited] = useState<Record<string, EditedCommitmentFields>>({});
  const [editedSummary, setEditedSummary] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ target: string; quote: string; start: number; end: number; rect: SelectionRect } | null>(null);
  const [openAnnotation, setOpenAnnotation] = useState<{ ids: string[]; rect: SelectionRect } | null>(null);
  const [pendingComment, setPendingComment] = useState("");
  const [lateReasonDraft, setLateReasonDraft] = useState("");
  const [lateReasonSaving, setLateReasonSaving] = useState(false);
  const [lateReasonSaved, setLateReasonSaved] = useState(false);
  const reviewRef = useRef<HTMLElement | null>(null);
  useModalScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setInput(plan?.focus_summary ?? plan?.freeform_intent ?? "");
    setLoomOpen(false);
    setLoomUrl("");
    setLoomTranscript("");
    setLoomError("");
    setLoomReadback(null);
    setInterpretation(null);
    setBuiltIntent("");
    setClarificationAnswers(plan?.clarification_answers ?? {});
    setError("");
    setAnnotations([]);
    setFeedbackMode(false);
    setFeedbackDirty(false);
    setDeleteArmed(false);
    setEdited({});
    setEditedSummary(null);
    setPendingSelection(null);
    setPendingComment("");
    setOpenAnnotation(null);
    setState("drafting");
  }, [open, plan?.id]);

  if (!open) return null;
  const hasDraft = interpretation !== null;
  const working = busy || state === "saving" || state === "interpreting" || state === "refining";
  const loomReady = Boolean(loomUrl.trim() && loomReadback?.usableForDay !== false && loomReadback);
  const effectiveInput = input.trim() || (loomReady ? LOOM_ONLY_PLAN_INTENT : "");
  const planningInput = builtIntent || effectiveInput;
  const canBuild = Boolean(effectiveInput) && (!loomReadback || loomReadback.usableForDay);
  const pendingValid = pendingSelection !== null && isAnnotationCommentValid(pendingComment);
  const unansweredClarifications = Boolean(interpretation?.clarifications.some((question) => !clarificationAnswers[question.id]?.trim()));
  const editedCommitments = interpretation ? diffEditedCommitments(interpretation.commitments, edited) : [];
  const invalidEdits = (editedSummary !== null && !editedSummary.trim()) || Object.values(edited).some((fields) => !fields.title.trim() || !fields.objective.trim());
  const hasDocumentEdits = editedCommitments.length > 0 || (editedSummary !== null && editedSummary.trim() !== interpretation?.summary);
  const hasUnfinishedEditorWork = feedbackMode && (hasDocumentEdits || pendingSelection !== null || !!pendingComment.trim());
  const refineReady = hasDraft && !invalidEdits && (annotations.length > 0 || hasDocumentEdits || pendingValid);
  // Escape hatch: when AI is down and the user is off-shift, a raw planning note
  // can still be saved. Every other path requires an AI-built draft first.
  const fallbackSave = state === "ai_unavailable" && !active && !hasDraft;
  const confirmBlockedReason = !hasDraft && !fallbackSave
    ? "Build your plan first — confirming unlocks after the first AI draft."
    : annotations.length > 0
      ? "Refine the plan or clear annotations to confirm."
      : invalidEdits
        ? "Plan titles, objectives, and the summary cannot be empty."
      : hasDocumentEdits || hasUnfinishedEditorWork
        ? "Finish your edits or refine before confirming."
        : unansweredClarifications
          ? "Answer the clarification questions to confirm."
          : null;
  const confirmDisabled = working || !planningInput || confirmBlockedReason !== null;

  const resetDraftState = () => {
    setInterpretation(null);
    setAnnotations([]);
    setFeedbackMode(false);
    setFeedbackDirty(false);
    setDeleteArmed(false);
    setEdited({});
    setEditedSummary(null);
    setPendingSelection(null);
    setPendingComment("");
    setBuiltIntent("");
  };

  /** Records the late-start reason on the session itself, independent of the
   * plan confirm so it survives closing the planner without saving a draft. */
  const saveLateReason = async () => {
    if (!onSaveLateReason || !lateReasonDraft.trim() || lateReasonSaving) return;
    setLateReasonSaving(true);
    try {
      await onSaveLateReason(lateReasonDraft.trim());
      setLateReasonDraft("");
      setLateReasonSaved(true);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Your late-start reason could not be saved.");
      setState("save_error");
    } finally {
      setLateReasonSaving(false);
    }
  };

  const build = async (loomOnly = false) => {
    const requestedInput = loomOnly ? LOOM_ONLY_PLAN_INTENT : effectiveInput;
    if (!requestedInput) return;
    resetDraftState();
    setState("interpreting");
    setError("");
    try {
      const loom = loomUrl.trim() ? { url: loomUrl.trim(), ...(loomTranscript.trim() ? { transcript: loomTranscript.trim() } : {}) } : undefined;
      const result = await onInterpret(requestedInput, loom);
      setInterpretation(result);
      setBuiltIntent(requestedInput);
      setState(result.clarifications.length ? "clarifying" : "reviewing");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Planning assistance is unavailable.");
      setState("ai_unavailable");
    }
  };

  /** Reads a pasted Loom link's public metadata and day verdict. */
  const readLoom = async () => {
    if (!loomUrl.trim() || !onLoomPreview || loomReading) return;
    setLoomReading(true);
    setLoomError("");
    try {
      const result = await onLoomPreview(loomUrl.trim());
      setLoomReadback(result);
      if (!result) setLoomError("The Loom link could not be read. Check the link and try again.");
    } catch {
      setLoomReadback(null);
      setLoomError("The Loom link could not be read. Check the link and try again.");
    } finally {
      setLoomReading(false);
    }
  };

  /** Commits a valid pending selection+comment into the annotation list. Returns the settled list. */
  const flushPendingAnnotation = (current: PlanAnnotation[]): PlanAnnotation[] => {
    if (!pendingValid || !pendingSelection) return current;
    const next = [...current, { id: `annotation-${Date.now()}-${current.length}`, target: pendingSelection.target, start: pendingSelection.start, end: pendingSelection.end, quote: pendingSelection.quote, comment: sanitizeComment(pendingComment) }];
    setAnnotations(next);
    setPendingSelection(null);
    setPendingComment("");
    return next;
  };

  const refine = async () => {
    if (!interpretation || !planningInput || working || !refineReady) return;
    const settled = flushPendingAnnotation(annotations);
    const edits = editedCommitments;
    const draftForServer: PlanningInterpretation = {
      ...interpretation,
      summary: editedSummary?.trim() ? editedSummary.trim() : interpretation.summary,
      commitments: applyEditsToCommitments(interpretation.commitments, edited),
    };
    setFeedbackMode(false);
    setFeedbackDirty(false);
    setDeleteArmed(false);
    setPendingSelection(null);
    setPendingComment("");
    setOpenAnnotation(null);
    setState("refining");
    setError("");
    try {
      const result = await onRefine(planningInput, draftForServer, settled, edits);
      setInterpretation(result);
      setBuiltIntent(planningInput);
      setAnnotations([]);
      setEdited({});
      setEditedSummary(null);
      setClarificationAnswers((current) => Object.fromEntries(Object.entries(current).filter(([id]) => result.clarifications.some((question) => question.id === id))));
      setState(result.clarifications.length ? "clarifying" : "reviewing");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Planning assistance is unavailable.");
      setState("ai_unavailable");
    }
  };

  const save = async () => {
    if (!planningInput || (!interpretation && !fallbackSave)) return;
    setState("saving");
    const effective = interpretation ? {
      ...interpretation,
      summary: editedSummary?.trim() ? editedSummary.trim() : interpretation.summary,
      commitments: applyEditsToCommitments(interpretation.commitments, edited),
    } : null;
    try {
      const result = await onConfirm(planningInput, effective, clarificationAnswers);
      if (result === "confirmed") { setState("confirmed"); return; }
      if (result === "conflict") { setState("conflict"); return; }
      if (result === "rebuild") {
        // The AI build expired or was already used. Drop the stale draft so the
        // footer offers Build again instead of retrying a dead build id.
        resetDraftState();
        setError("The AI plan build expired. Build the plan again to confirm it.");
        setState("drafting");
        return;
      }
      if (result === "failed") { setState("save_error"); return; }
      setState(result === "queued" ? "offline_fallback" : "saved");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Your plan was not saved.");
      setState("save_error");
    }
  };

  const discardDraft = () => {
    resetDraftState();
    setState("drafting");
  };

  const toggleFeedback = () => {
    if (feedbackMode) {
      // Comments are explicit: leaving edit mode never submits unfinished feedback.
    setPendingSelection(null);
    setPendingComment("");
    setLateReasonDraft("");
    setLateReasonSaving(false);
    setLateReasonSaved(false);
      setOpenAnnotation(null);
      setFeedbackMode(false);
      setFeedbackDirty(false);
      setDeleteArmed(false);
    } else {
      setFeedbackMode(true);
      setDeleteArmed(false);
      setOpenAnnotation(null);
    }
  };

  const editFor = (clientId: string, fallback: EditedCommitmentFields): EditedCommitmentFields => edited[clientId] ?? fallback;
  const updateEdit = (clientId: string, fallback: EditedCommitmentFields, patch: Partial<EditedCommitmentFields>) => {
    setEdited((current) => ({ ...current, [clientId]: { ...editFor(clientId, fallback), ...patch } }));
    setFeedbackDirty(true);
  };

  /** Selection is valid only inside one semantic text block. */
  const captureDocumentSelection = () => {
    // Selection annotates in every mode; typing in the draft dismisses the pill
    // so selecting text to replace is never hijacked.
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const elementFor = (node: Node | null) => node instanceof Element ? node : node?.parentElement ?? null;
    const startHolder = elementFor(range.startContainer)?.closest?.("[data-annotate-target]") ?? null;
    const endHolder = elementFor(range.endContainer)?.closest?.("[data-annotate-target]") ?? null;
    const card = reviewRef.current;
    if (!startHolder || startHolder !== endHolder || !card || !card.contains(startHolder)) return;
    const target = startHolder.getAttribute("data-annotate-target");
    const text = startHolder.textContent ?? "";
    const quote = sanitizeQuote(range.toString());
    const before = document.createRange();
    before.selectNodeContents(startHolder);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;
    if (!target || !quote || !isAnnotationRangeValid(text, start, end)) return;
    const box = range.getBoundingClientRect();
    setPendingSelection({ target, quote, start, end, rect: { top: box.top, left: box.left, width: box.width, height: box.height, bottom: box.bottom } });
    setOpenAnnotation(null);
    setFeedbackDirty(true);
  };

  const clearTransientAnnotator = () => {
    setPendingSelection(null);
    setPendingComment("");
    setOpenAnnotation(null);
  };

  const openAnnotationCard = (ids: string[], element: Element) => {
    const rect = rectFromElement(element);
    if (!rect) return;
    setPendingSelection(null);
    setPendingComment("");
    setOpenAnnotation({ ids, rect });
  };

  const updateAnnotation = (id: string, comment: string) => {
    setAnnotations((current) => current.map((annotation) => annotation.id === id ? { ...annotation, comment } : annotation));
    setFeedbackDirty(true);
  };

  const deleteAnnotation = (id: string) => {
    setAnnotations((current) => {
      const next = current.filter((annotation) => annotation.id !== id);
      setOpenAnnotation((open) => open ? { ...open, ids: open.ids.filter((candidate) => candidate !== id) } : null);
      return next;
    });
    setFeedbackDirty(true);
  };

  const effectiveSummary = interpretation && editedSummary !== null ? editedSummary : interpretation?.summary ?? "";

  const toggleLoom = () => {
    if (loomOpen) {
      setLoomOpen(false);
      setLoomUrl("");
      setLoomTranscript("");
      setLoomReadback(null);
      setLoomError("");
      return;
    }
    setLoomOpen(true);
  };

  return <div className="task-modal-backdrop planning-backdrop" role="presentation">
    <section className="planning-session" role="dialog" aria-modal="true" aria-labelledby="planning-session-title">
      <header><div><small>Today</small><h2 id="planning-session-title">Plan your day</h2></div><button aria-label="Close planning session" onClick={onClose} disabled={busy || state === "saving"}><X size={16} /></button></header>
      <div className="planning-session-body">
        <div className="planning-intent-heading">
          <label htmlFor="planning-intent">What should today's plan focus on?</label>
          <span>{loomEnabled ? "Optional when you use a Loom" : "Start with a clear outcome"}</span>
        </div>
        <textarea id="planning-intent" autoFocus maxLength={4000} value={input} disabled={busy || state === "saving" || state === "interpreting" || state === "refining" || state === "confirmed" || state === "saved"} onChange={(event) => { setInput(event.target.value); resetDraftState(); if (state !== "drafting") setState("drafting"); }} placeholder={loomEnabled ? "Add a direction, or build directly from your Loom below." : "Fix the failing integration test, then get the migration ready for review."} />
        <small className="planning-provenance">Your words stay attached to the plan. Work OS only suggests structure for your review.</small>
        {loomEnabled && <div className="planning-loom">
          <button type="button" className={`planning-loom-toggle${loomOpen ? " active" : ""}`} aria-expanded={loomOpen} onClick={toggleLoom} disabled={working}>
            <span className="planning-loom-toggle-label"><Video size={15} /><span><strong>{loomOpen ? "Loom source attached" : "Plan from a Loom recording"}</strong><small>{loomOpen ? "Recording details and transcript" : "Use the recording instead of writing a brief"}</small></span></span>
            <span className="planning-loom-toggle-action">{loomOpen ? "Remove" : "Add"}</span>
          </button>
          {loomOpen ? <div className="planning-loom-panel">
            <div className="planning-loom-heading"><div><strong>Recording link</strong><small>Read the date first, then build from its transcript.</small></div><span className="planning-loom-badge">Optional</span></div>
            <div className="planning-loom-row">
              <input value={loomUrl} onChange={(event) => { setLoomUrl(event.target.value); setLoomReadback(null); setLoomError(""); }} placeholder="https://www.loom.com/share/…" maxLength={500} aria-label="Loom share link" />
              <button type="button" className="secondary" disabled={!loomUrl.trim() || loomReading || working} onClick={() => void readLoom()}>{loomReading ? "Reading…" : "Read Loom"}</button>
            </div>
            {loomError ? <p className="planning-loom-message is-error" role="alert"><AlertTriangle size={14} />{loomError}</p> : null}
            {loomReadback ? <div className={`planning-loom-readback${loomReadback.usableForDay ? "" : " is-warning"}`} role="status"><CheckCircle2 size={15} /><span><strong>{loomReadback.title ?? "Loom recording"}</strong><small>Recorded {loomReadback.createdLocalDate ? formatWorkOsDate(loomReadback.createdLocalDate) : "on an unverified date"}{loomReadback.durationSeconds ? ` - ${Math.round(loomReadback.durationSeconds / 60)} min` : ""}</small>{loomReadback.usableForDay ? <em>Ready for today's plan</em> : <em>Not usable for today's plan</em>}</span></div> : null}
            <details className="planning-loom-transcript"><summary>{loomTranscript.trim() ? "Transcript attached" : "Add transcript for task extraction"}</summary><textarea value={loomTranscript} onChange={(event) => setLoomTranscript(event.target.value)} rows={3} maxLength={50000} placeholder="In Loom, open Transcript, then Copy and paste it here." aria-label="Loom transcript" /></details>
            {loomReadback && !loomTranscript.trim() ? <p className="planning-loom-message"><Video size={14} /><span>The link confirms the recording, but Loom does not expose its spoken content here. Add the transcript if you want tasks extracted from what was said.</span></p> : null}
            {loomReadback && loomReady && input.trim() ? <button type="button" className="planning-loom-use" onClick={() => void build(true)} disabled={working}>Use Loom only <span>Build without the text above</span></button> : null}
            <small className="planning-loom-note">Nothing is filed from the recording. You will review the plan before anything is saved.</small>
          </div> : null}
        </div>}
        {lateReasonRequired && <div className="planning-notice planning-late-reason" role="status">
          <AlertTriangle size={16} />
          <span><strong>Late start.</strong> This workday began 30+ minutes after your scheduled start. Record the reason to clear Otto’s red signal.</span>
          <div className="planning-late-reason-field">
            <label htmlFor="planning-late-reason">Reason for the late start</label>
            <textarea id="planning-late-reason" maxLength={1000} value={lateReasonDraft} disabled={lateReasonSaving} onChange={(event) => setLateReasonDraft(event.target.value)} placeholder="What delayed your start?" />
            <button type="button" className="secondary" disabled={!lateReasonDraft.trim() || lateReasonSaving} onClick={() => void saveLateReason()}>{lateReasonSaving ? "Saving…" : "Save reason"}</button>
          </div>
        </div>}
        {lateReasonSaved && !lateReasonRequired && <div className="planning-confirmed" role="status"><CheckCircle2 size={17} /><span>Late-start reason recorded — Otto is back to his usual colour.</span></div>}
        {state === "interpreting" && <div className="planning-loading" role="status"><Wave className="planning-wave" /><span>Building a reviewable plan…</span></div>}
        {state === "refining" && <div className="planning-loading" role="status"><FadeArc size={16} /><span>Refining your plan with your feedback…</span></div>}
        {interpretation && <section className={`planning-review${feedbackMode ? " is-editing" : ""}`} ref={reviewRef} onMouseUp={captureDocumentSelection} onKeyUp={captureDocumentSelection}>
          <div className="planning-review-head">
            <small>Review commitments</small>
            <div className="planning-review-actions">
              <button type="button" className={`planning-icon-button${feedbackMode ? " is-active" : ""}`} aria-pressed={feedbackMode} aria-label={feedbackMode ? "Finish feedback and edits" : "Give feedback or edit the draft"} title={feedbackMode ? "Finish feedback and edits" : "Give feedback or edit the draft"} onClick={toggleFeedback} disabled={working || state === "confirmed"}>{feedbackMode ? <Check size={15} /> : <Pencil size={15} />}</button>
              <button type="button" className={`planning-icon-button${deleteArmed ? " is-armed" : ""}`} aria-label={deleteArmed ? "Confirm deletion of this draft" : "Delete this draft and start over"} title={deleteArmed ? "Click again to delete this draft" : "Delete this draft and start over"} onClick={() => { if (deleteArmed) discardDraft(); else setDeleteArmed(true); }} disabled={working || state === "confirmed"}>{deleteArmed ? <Check size={15} /> : <Trash2 size={15} />}</button>
            </div>
          </div>
          {deleteArmed && <p className="planning-notice planning-delete-notice" role="status"><Trash2 size={15} /><span>Delete this draft and start over? Click the trash button again to confirm.</span></p>}
          <p className="planning-status planning-materialize-hint" role="status"><CheckCircle2 size={15} /><span>{(() => {
            const newGoals = interpretation.commitments.filter((commitment) => !commitment.linkedTaskId).length;
            const subtasks = interpretation.commitments.reduce((total, commitment) => total + commitment.successCriteria.length, 0);
            const taskCopy = `${newGoals} Work OS task${newGoals === 1 ? "" : "s"}`;
            const subtaskCopy = `${subtasks} subtask${subtasks === 1 ? "" : "s"}`;
            if (newGoals && subtasks) return `Confirming creates ${taskCopy} with ${subtaskCopy}.`;
            if (newGoals) return `Confirming creates ${taskCopy}.`;
            if (subtasks) return `Confirming adds ${subtaskCopy} to your existing tasks.`;
            return "";
          })()}</span></p>
          {hasDraft && <p className="planning-status planning-feedback-hint" role="status"><Pencil size={15} /><span>{feedbackMode ? "Editing the draft — select text to attach feedback, or keep typing." : "Select text to attach feedback, or switch to Edit to change the wording."}</span></p>}
          {pendingSelection && <SelectionAnnotator quote={pendingSelection.quote} anchor={pendingSelection.rect} value={pendingComment} canSave={pendingValid} disabled={working} autoFocus={!feedbackMode} onChange={(value) => { setPendingComment(value); setFeedbackDirty(true); }} onSave={() => { flushPendingAnnotation(annotations); }} onCancel={() => { setPendingSelection(null); setPendingComment(""); }} />}
          {openAnnotation && (() => {
            const annotationsForCard = annotations.filter((annotation) => openAnnotation.ids.includes(annotation.id));
            return annotationsForCard.length ? <AnnotationPopover annotations={annotationsForCard} anchor={openAnnotation.rect} onEdit={updateAnnotation} onDelete={deleteAnnotation} onClose={() => setOpenAnnotation(null)} /> : null;
          })()}
          <div className="planning-document-summary-row"><PlanningDocumentText className="planning-document-summary" target="summary" value={effectiveSummary} annotations={annotations} editing={feedbackMode} label="Plan summary" maxLength={500} onOpenAnnotation={openAnnotationCard} onDocumentInput={clearTransientAnnotator} onChange={(value) => { setEditedSummary(value); setFeedbackDirty(true); }} />{!feedbackMode && annotationsForTarget(annotations, "summary").length > 0 && <span className="planning-annotation-bubble" aria-label={`${annotationsForTarget(annotations, "summary").length} annotations on the summary`}>{annotationsForTarget(annotations, "summary").length}</span>}</div>
          {interpretation.commitments.map((commitment, index) => {
            const targetTitle = `title:${commitment.clientId}`;
            const targetObjective = `objective:${commitment.clientId}`;
            const targetCriteria = `criteria:${commitment.clientId}`;
            const fields = editFor(commitment.clientId, { title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria });
            const bubbleCount = countAnnotationsForCommitment(annotations, commitment.clientId);
            const editable = feedbackMode;
            return <article key={commitment.clientId}>
              <b><span className="planning-review-index">{String(index + 1).padStart(2, "0")}</span>{!feedbackMode && bubbleCount > 0 && <span className="planning-annotation-bubble" aria-label={`${bubbleCount} annotations on this commitment`}>{bubbleCount}</span>}</b>
              <div>
                <PlanningDocumentText className="planning-document-title" target={targetTitle} value={fields.title} annotations={annotations} editing={editable} label={`Commitment ${index + 1} title`} maxLength={240} onOpenAnnotation={openAnnotationCard} onDocumentInput={clearTransientAnnotator} onChange={(value) => updateEdit(commitment.clientId, { title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria }, { title: value })} />
                <PlanningDocumentText className="planning-document-objective" target={targetObjective} value={fields.objective} annotations={annotations} editing={editable} label={`Commitment ${index + 1} objective`} maxLength={1000} onOpenAnnotation={openAnnotationCard} onDocumentInput={clearTransientAnnotator} onChange={(value) => updateEdit(commitment.clientId, { title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria }, { objective: value })} />
                {(editable || fields.successCriteria.length > 0) && <>
                  <small>Done when</small>
                  <PlanningDocumentText className="planning-document-criteria" target={targetCriteria} value={fields.successCriteria.join("\n")} annotations={annotations} editing={editable} label={`Commitment ${index + 1} success criteria, one per line`} maxLength={1500} onOpenAnnotation={openAnnotationCard} onDocumentInput={clearTransientAnnotator} onChange={(value) => updateEdit(commitment.clientId, { title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria }, { successCriteria: parseCriteriaLines(value) })} />
                </>}
              </div>
            </article>;
          })}
          {interpretation.clarifications.length > 0 && <div className="planning-clarifications"><strong>{interpretation.clarifications.length === 1 ? "One thing to clarify" : `${interpretation.clarifications.length} things to clarify`}</strong>{interpretation.clarifications.map((question) => <label key={question.id} htmlFor={`planning-clarification-${question.id}`}><span>{question.question}</span><textarea id={`planning-clarification-${question.id}`} maxLength={1000} value={clarificationAnswers[question.id] ?? ""} disabled={busy || state === "saving" || state === "refining" || state === "confirmed"} onChange={(event) => setClarificationAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /></label>)}</div>}
        </section>}
        {state === "ai_unavailable" && <div className="planning-notice"><AlertTriangle size={16} /><span>{error} {hasDraft ? "Your current draft is kept." : active ? "Try building again — confirming needs an AI-built plan while on shift." : "You can still save your own planning note."}</span></div>}
        {state === "offline_fallback" && <div className="planning-notice"><AlertTriangle size={16} /><span>{interpretation ? "Your structured plan is queued locally. It is not confirmed until sync succeeds." : "Your raw planning note is queued locally."}</span></div>}
        {state === "conflict" && <div className="planning-notice"><AlertTriangle size={16} /><span>Your workspace has a newer confirmed plan, and it is showing now. Close this and reopen the focus editor to change it.</span></div>}
        {state === "save_error" && <div className="planning-notice"><AlertTriangle size={16} /><span>{error || "Your plan was not saved. Check the connection or correct the plan and try again."}</span></div>}
        {state === "saved" && <div className="planning-confirmed"><CheckCircle2 size={17} /><span>Your plan is saved. Confirm it when your shift starts.</span></div>}
        {state === "confirmed" && <div className="planning-confirmed"><CheckCircle2 size={17} /><span>Your daily commitments are confirmed.</span></div>}
      </div>
      <footer>
        {state !== "confirmed" && state !== "saved" && <>
          {confirmBlockedReason && planningInput && <small className="planning-footer-hint">{confirmBlockedReason}</small>}
          <button className="secondary" onClick={onClose} disabled={busy || state === "saving"}>Close</button>
          {annotations.length > 0 && <span className="planning-annotation-pill">{annotations.length} Annotation{annotations.length === 1 ? "" : "s"}<button type="button" aria-label="Clear all annotations" title="Clear all annotations" onClick={() => { setAnnotations([]); setPendingSelection(null); setPendingComment(""); }}><X size={12} /></button></span>}
          <button className="secondary planning-refine-button" onClick={() => void refine()} disabled={!hasDraft || working || !refineReady} title={!hasDraft ? "Build your plan first" : !refineReady ? "Add feedback or edits to refine" : "Refine the draft with your feedback"}>Refine plan{annotations.length > 0 && <span className="planning-refine-count" aria-label={`${annotations.length} annotations`}>{annotations.length}</span>}</button>
           {!hasDraft && !fallbackSave
             ? <button className="primary" onClick={() => void build()} disabled={!canBuild || working}>{input.trim() || !loomReady ? "Build my plan" : "Build from Loom"}</button>
             : <button className="primary" onClick={() => void save()} disabled={confirmDisabled}>{active ? "Confirm my day" : "Save plan"}</button>}
        </>}
        {(state === "confirmed" || state === "saved") && <button className="primary" onClick={onClose}>Continue working</button>}
      </footer>
    </section>
  </div>;
}
