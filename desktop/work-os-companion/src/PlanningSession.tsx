import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { AlertTriangle, Check, CheckCircle2, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { DailyPlan } from "./types";
import {
  annotationsForTarget,
  applyEditsToCommitments,
  countAnnotationsForCommitment,
  diffEditedCommitments,
  isAnnotationCommentValid,
  parseCriteriaLines,
  sanitizeComment,
  sanitizeQuote,
  type PlanAnnotation,
  type PlanDraftEdit,
} from "./planningAnnotations";

export type PlanningSessionState = "idle" | "drafting" | "interpreting" | "refining" | "clarifying" | "reviewing" | "saving" | "confirmed" | "offline_fallback" | "ai_unavailable" | "save_error" | "conflict";
export type PlanningInterpretation = {
  rawIntent: string;
  summary: string;
  commitments: Array<{ clientId: string; linkedTaskId?: string; title: string; objective: string; successCriteria: string[]; dependency?: string; blocker?: string; estimatedMinutes?: number; sourceRefs: Array<{ provider: string; type: string; id: string; label?: string }>; confidence: number }>;
  clarifications: Array<{ id: string; commitmentId?: string; question: string; reason: string }>;
  readiness: "ready" | "needs_one_clarification" | "needs_multiple_clarifications";
};

export type EditedCommitmentFields = { title: string; objective: string; successCriteria: string[] };

/** Wraps annotated quotes in <mark> so feedback targets stay visible after review. */
function annotatedNodes(text: string, target: string, annotations: PlanAnnotation[], keyPrefix: string): ReactNode[] {
  const marks = [...new Set(annotationsForTarget(annotations, target).map((annotation) => annotation.quote).filter((quote) => quote.length > 0 && text.includes(quote)))].sort((a, b) => b.length - a.length);
  if (!marks.length) return [text];
  let parts: ReactNode[] = [text];
  marks.forEach((mark, markIndex) => {
    const next: ReactNode[] = [];
    parts.forEach((part, partIndex) => {
      if (typeof part !== "string" || !part.includes(mark)) { next.push(part); return; }
      const split = part.split(mark);
      split.forEach((chunk, chunkIndex) => {
        if (chunk) next.push(chunk);
        if (chunkIndex < split.length - 1) next.push(<mark key={`${keyPrefix}-m${markIndex}-p${partIndex}-c${chunkIndex}`} className="planning-annotation-mark">{mark}</mark>);
      });
    });
    parts = next;
  });
  return parts;
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
}: {
  open: boolean;
  plan: DailyPlan | null;
  active: boolean;
  busy: boolean;
  onClose: () => void;
  onInterpret: (input: string) => Promise<PlanningInterpretation>;
  onRefine: (input: string, draft: PlanningInterpretation, annotations: PlanAnnotation[], edits: PlanDraftEdit[]) => Promise<PlanningInterpretation>;
  onConfirm: (input: string, interpretation: PlanningInterpretation | null, clarificationAnswers: Record<string, string>) => Promise<"confirmed" | "saved" | "queued" | "conflict" | "failed">;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<PlanningSessionState>("idle");
  const [interpretation, setInterpretation] = useState<PlanningInterpretation | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [annotations, setAnnotations] = useState<PlanAnnotation[]>([]);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedbackDirty, setFeedbackDirty] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [edited, setEdited] = useState<Record<string, EditedCommitmentFields>>({});
  const [editedSummary, setEditedSummary] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{ target: string; quote: string } | null>(null);
  const [pendingComment, setPendingComment] = useState("");
  const reviewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setInput(plan?.freeform_intent ?? "");
    setInterpretation(null);
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
    setState("drafting");
  }, [open, plan?.id]);

  if (!open) return null;
  const hasDraft = interpretation !== null;
  const editsLocked = annotations.length > 0;
  const working = busy || state === "saving" || state === "interpreting" || state === "refining";
  const pendingValid = pendingSelection !== null && isAnnotationCommentValid(pendingComment);
  const unansweredClarifications = Boolean(interpretation?.clarifications.some((question) => !clarificationAnswers[question.id]?.trim()));
  const refineReady = hasDraft && (annotations.length > 0 || (interpretation ? diffEditedCommitments(interpretation.commitments, edited).length > 0 : false) || editedSummary !== null || pendingValid);
  // Escape hatch: when AI is down and the user is off-shift, a raw planning note
  // can still be saved. Every other path requires an AI-built draft first.
  const fallbackSave = state === "ai_unavailable" && !active && !hasDraft;
  const confirmBlockedReason = !hasDraft && !fallbackSave
    ? "Build your plan first — confirming unlocks after the first AI draft."
    : annotations.length > 0
      ? "Refine the plan or clear annotations to confirm."
      : feedbackMode && feedbackDirty
        ? "Finish your edits or refine before confirming."
        : unansweredClarifications
          ? "Answer the clarification questions to confirm."
          : null;
  const confirmDisabled = working || !input.trim() || confirmBlockedReason !== null;

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
  };

  const build = async () => {
    if (!input.trim()) return;
    resetDraftState();
    setState("interpreting");
    setError("");
    try {
      const result = await onInterpret(input.trim());
      setInterpretation(result);
      setState(result.clarifications.length ? "clarifying" : "reviewing");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Planning assistance is unavailable.");
      setState("ai_unavailable");
    }
  };

  /** Commits a valid pending selection+comment into the annotation list. Returns the settled list. */
  const flushPendingAnnotation = (current: PlanAnnotation[]): PlanAnnotation[] => {
    if (!pendingValid || !pendingSelection) return current;
    const next = [...current, { id: `annotation-${Date.now()}-${current.length}`, target: pendingSelection.target, quote: pendingSelection.quote, comment: sanitizeComment(pendingComment) }];
    setAnnotations(next);
    setPendingSelection(null);
    setPendingComment("");
    return next;
  };

  const refine = async () => {
    if (!interpretation || !input.trim() || working || !refineReady) return;
    const settled = flushPendingAnnotation(annotations);
    const edits = diffEditedCommitments(interpretation.commitments, edited);
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
    setState("refining");
    setError("");
    try {
      const result = await onRefine(input.trim(), draftForServer, settled, edits);
      setInterpretation(result);
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
    if (!input.trim() || (!interpretation && !fallbackSave)) return;
    setState("saving");
    const effective = interpretation ? {
      ...interpretation,
      summary: editedSummary?.trim() ? editedSummary.trim() : interpretation.summary,
      commitments: applyEditsToCommitments(interpretation.commitments, edited),
    } : null;
    const result = await onConfirm(input.trim(), effective, clarificationAnswers);
    if (result === "confirmed") { setState("confirmed"); return; }
    if (result === "conflict") { setState("conflict"); return; }
    if (result === "failed") { setState("save_error"); return; }
    setState(result === "queued" ? "offline_fallback" : "drafting");
  };

  const discardDraft = () => {
    resetDraftState();
    setState("drafting");
  };

  const toggleFeedback = () => {
    if (feedbackMode) {
      // Exiting feedback mode marks in-progress work done: keep valid annotations, drop the composer.
      flushPendingAnnotation(annotations);
      setFeedbackMode(false);
      setFeedbackDirty(false);
      setDeleteArmed(false);
    } else {
      setFeedbackMode(true);
      setDeleteArmed(false);
    }
  };

  const editFor = (clientId: string, fallback: EditedCommitmentFields): EditedCommitmentFields => edited[clientId] ?? fallback;
  const updateEdit = (clientId: string, fallback: EditedCommitmentFields, patch: Partial<EditedCommitmentFields>) => {
    setEdited((current) => ({ ...current, [clientId]: { ...editFor(clientId, fallback), ...patch } }));
    setFeedbackDirty(true);
  };

  /** Mouse selection over static annotated text (used once edits lock). */
  const captureStaticSelection = () => {
    if (!feedbackMode || !editsLocked) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const quote = sanitizeQuote(selection.toString());
    if (!quote) return;
    const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement ?? null;
    const holder = anchor?.closest?.("[data-annotate-target]") ?? null;
    const card = reviewRef.current;
    if (!holder || !card || !card.contains(holder)) return;
    const target = holder.getAttribute("data-annotate-target");
    if (!target) return;
    setPendingSelection({ target, quote });
    setFeedbackDirty(true);
  };

  /** Keyboard/mouse selection inside editable fields (inputs support onSelect, not window.getSelection). */
  const captureFieldSelection = (target: string) => (event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!feedbackMode || editsLocked) return;
    const element = event.currentTarget;
    const { selectionStart, selectionEnd, value } = element;
    if (selectionStart === null || selectionStart === undefined || selectionEnd === null || selectionEnd === undefined || selectionEnd <= selectionStart) return;
    const quote = sanitizeQuote(value.slice(selectionStart, selectionEnd));
    if (!quote) return;
    setPendingSelection({ target, quote });
    setFeedbackDirty(true);
  };

  /** Maps a character offset inside a multi-line criteria editor to its criterion index. */
  const criteriaIndexAtOffset = (value: string, offset: number): number => value.slice(0, Math.max(0, offset)).split("\n").length - 1;

  const effectiveSummary = interpretation && editedSummary !== null ? editedSummary : interpretation?.summary ?? "";

  return <div className="task-modal-backdrop planning-backdrop" role="presentation">
    <section className="planning-session" role="dialog" aria-modal="true" aria-labelledby="planning-session-title">
      <header><div><small>Today</small><h2 id="planning-session-title">Plan your day</h2></div><button aria-label="Close planning session" onClick={onClose} disabled={busy || state === "saving"}><X size={16} /></button></header>
      <div className="planning-session-body">
        <label htmlFor="planning-intent">What do you want to get done today?</label>
        <textarea id="planning-intent" autoFocus maxLength={4000} value={input} disabled={busy || state === "saving" || state === "refining" || state === "confirmed"} onChange={(event) => { setInput(event.target.value); resetDraftState(); if (state !== "drafting") setState("drafting"); }} placeholder="Fix the failing integration test, then get the migration ready for review." />
        <small className="planning-provenance">Your words stay attached to the plan. Work OS only suggests structure for your review.</small>
        {state === "interpreting" && <p className="planning-status"><Sparkles size={15} /> Building a reviewable plan…</p>}
        {state === "refining" && <p className="planning-status"><Sparkles size={15} /> Refining your plan with your feedback…</p>}
        {interpretation && <section className="planning-review" aria-live="polite" ref={reviewRef} onMouseUp={captureStaticSelection}>
          <div className="planning-review-head">
            <small>Review commitments</small>
            <div className="planning-review-actions">
              <button type="button" className={`planning-icon-button${feedbackMode ? " is-active" : ""}`} aria-pressed={feedbackMode} aria-label={feedbackMode ? "Finish feedback and edits" : "Give feedback or edit the draft"} title={feedbackMode ? "Finish feedback and edits" : "Give feedback or edit the draft"} onClick={toggleFeedback} disabled={working || state === "confirmed"}>{feedbackMode ? <Check size={15} /> : <Pencil size={15} />}</button>
              <button type="button" className={`planning-icon-button${deleteArmed ? " is-armed" : ""}`} aria-label={deleteArmed ? "Confirm deletion of this draft" : "Delete this draft and start over"} title={deleteArmed ? "Click again to delete this draft" : "Delete this draft and start over"} onClick={() => { if (deleteArmed) discardDraft(); else setDeleteArmed(true); }} disabled={working || state === "confirmed"}>{deleteArmed ? <Check size={15} /> : <Trash2 size={15} />}</button>
            </div>
          </div>
          {deleteArmed && <p className="planning-notice planning-delete-notice" role="status"><Trash2 size={15} /><span>Delete this draft and start over? Click the trash button again to confirm.</span></p>}
          {feedbackMode && editsLocked && <p className="planning-notice planning-lock-notice" role="status"><AlertTriangle size={15} /><span>Edits are locked while annotations exist. Clear annotations to edit the text again.</span></p>}
          {feedbackMode && !editsLocked && <p className="planning-status planning-feedback-hint" role="status"><Pencil size={15} /><span>Edit any section directly, or highlight text to attach feedback. Your first annotation locks further edits.</span></p>}
          {feedbackMode && pendingSelection && <div className="planning-feedback-composer">
            <small>Feedback on “{pendingSelection.quote.length > 80 ? `${pendingSelection.quote.slice(0, 80)}…` : pendingSelection.quote}”</small>
            <textarea aria-label="Feedback on the highlighted text" maxLength={1000} value={pendingComment} onChange={(event) => { setPendingComment(event.target.value); setFeedbackDirty(true); }} placeholder="What should change here?" />
            <div className="planning-feedback-composer-row">
              <button type="button" className="secondary" onClick={() => { setPendingSelection(null); setPendingComment(""); }}>Cancel</button>
              <button type="button" className="primary" disabled={!pendingValid} onClick={() => { flushPendingAnnotation(annotations); }}>Add feedback</button>
            </div>
          </div>}
          {feedbackMode && !editsLocked
            ? <input className="planning-edit-summary" aria-label="Plan summary" maxLength={500} value={effectiveSummary} data-annotate-target="summary" onSelect={captureFieldSelection("summary")} onChange={(event) => { setEditedSummary(event.target.value); setFeedbackDirty(true); }} />
            : <h3 data-annotate-target="summary">{annotatedNodes(interpretation.summary, "summary", annotations, "summary")}{annotationsForTarget(annotations, "summary").length > 0 && <span className="planning-annotation-bubble" aria-label={`${annotationsForTarget(annotations, "summary").length} annotations on the summary`}>{annotationsForTarget(annotations, "summary").length}</span>}</h3>}
          {interpretation.commitments.map((commitment, index) => {
            const targetTitle = `title:${commitment.clientId}`;
            const targetObjective = `objective:${commitment.clientId}`;
            const fields = editFor(commitment.clientId, { title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria });
            const bubbleCount = countAnnotationsForCommitment(annotations, commitment.clientId);
            const editable = feedbackMode && !editsLocked;
            return <article key={commitment.clientId}>
              <b><span className="planning-review-index">{String(index + 1).padStart(2, "0")}</span>{!feedbackMode && bubbleCount > 0 && <span className="planning-annotation-bubble" aria-label={`${bubbleCount} annotations on this commitment`}>{bubbleCount}</span>}</b>
              <div>
                {editable
                  ? <input className="planning-edit-title" aria-label={`Commitment ${index + 1} title`} maxLength={240} value={fields.title} data-annotate-target={targetTitle} onSelect={captureFieldSelection(targetTitle)} onChange={(event) => updateEdit(commitment.clientId, { title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria }, { title: event.target.value })} />
                  : <strong data-annotate-target={targetTitle}>{annotatedNodes(fields.title, targetTitle, annotations, targetTitle)}</strong>}
                {editable
                  ? <textarea className="planning-edit-objective" aria-label={`Commitment ${index + 1} objective`} maxLength={1000} value={fields.objective} data-annotate-target={targetObjective} onSelect={captureFieldSelection(targetObjective)} onChange={(event) => updateEdit(commitment.clientId, { title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria }, { objective: event.target.value })} />
                  : <p data-annotate-target={targetObjective}>{annotatedNodes(fields.objective, targetObjective, annotations, targetObjective)}</p>}
                {fields.successCriteria.length > 0 && <>
                  <small>Done when</small>
                  {editable
                    ? <textarea className="planning-edit-criteria" aria-label={`Commitment ${index + 1} success criteria, one per line`} value={fields.successCriteria.join("\n")} data-annotate-criteria={commitment.clientId} onSelect={(event) => {
                      if (!feedbackMode || editsLocked) return;
                      const element = event.currentTarget;
                      const { selectionStart, selectionEnd, value } = element;
                      if (selectionStart === null || selectionStart === undefined || selectionEnd === null || selectionEnd === undefined || selectionEnd <= selectionStart) return;
                      const quote = sanitizeQuote(value.slice(selectionStart, selectionEnd));
                      if (!quote) return;
                      const lineIndex = Math.max(0, criteriaIndexAtOffset(value, selectionStart));
                      setPendingSelection({ target: `criterion:${commitment.clientId}:${lineIndex}`, quote });
                      setFeedbackDirty(true);
                    }} onChange={(event) => updateEdit(commitment.clientId, { title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria }, { successCriteria: parseCriteriaLines(event.target.value) })} />
                    : <ul>{fields.successCriteria.map((criterion, criterionIndex) => {
                      const target = `criterion:${commitment.clientId}:${criterionIndex}`;
                      return <li key={`${commitment.clientId}-criterion-${criterionIndex}`} data-annotate-target={target}>{annotatedNodes(criterion, target, annotations, target)}</li>;
                    })}</ul>}
                </>}
              </div>
            </article>;
          })}
          {interpretation.clarifications.length > 0 && <div className="planning-clarifications"><strong>{interpretation.clarifications.length === 1 ? "One thing to clarify" : "Two things to clarify"}</strong>{interpretation.clarifications.map((question) => <label key={question.id} htmlFor={`planning-clarification-${question.id}`}><span>{question.question}</span><textarea id={`planning-clarification-${question.id}`} maxLength={1000} value={clarificationAnswers[question.id] ?? ""} disabled={busy || state === "saving" || state === "refining" || state === "confirmed"} onChange={(event) => setClarificationAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /></label>)}</div>}
        </section>}
        {state === "ai_unavailable" && <div className="planning-notice"><AlertTriangle size={16} /><span>{error} {hasDraft ? "Your current draft is kept." : active ? "Try building again — confirming needs an AI-built plan while on shift." : "You can still save your own planning note."}</span></div>}
        {state === "offline_fallback" && <div className="planning-notice"><AlertTriangle size={16} /><span>Your raw plan is queued locally. It is not a confirmed structured plan yet.</span></div>}
        {state === "conflict" && <div className="planning-notice"><AlertTriangle size={16} /><span>This plan changed elsewhere. Refresh before saving again.</span></div>}
        {state === "save_error" && <div className="planning-notice"><AlertTriangle size={16} /><span>Your plan was not saved. Check the connection or correct the plan and try again.</span></div>}
        {state === "confirmed" && <div className="planning-confirmed"><CheckCircle2 size={17} /><span>Your daily commitments are confirmed.</span></div>}
      </div>
      <footer>
        {state !== "confirmed" && <>
          {confirmBlockedReason && input.trim() && <small className="planning-footer-hint">{confirmBlockedReason}</small>}
          <button className="secondary" onClick={onClose} disabled={busy || state === "saving"}>Close</button>
          {annotations.length > 0 && <span className="planning-annotation-pill">{annotations.length} Annotation{annotations.length === 1 ? "" : "s"}<button type="button" aria-label="Clear all annotations" title="Clear all annotations" onClick={() => { setAnnotations([]); setPendingSelection(null); setPendingComment(""); }}><X size={12} /></button></span>}
          <button className="secondary planning-refine-button" onClick={() => void refine()} disabled={!hasDraft || working || !refineReady} title={!hasDraft ? "Build your plan first" : !refineReady ? "Add feedback or edits to refine" : "Refine the draft with your feedback"}>Refine plan{annotations.length > 0 && <span className="planning-refine-count" aria-label={`${annotations.length} annotations`}>{annotations.length}</span>}</button>
          {!hasDraft && !fallbackSave
            ? <button className="secondary" onClick={() => void build()} disabled={!input.trim() || working}>Build my plan</button>
            : <button className="primary" onClick={() => void save()} disabled={confirmDisabled}>{active ? "Confirm my day" : "Save planning note"}</button>}
        </>}
        {state === "confirmed" && <button className="primary" onClick={onClose}>Continue working</button>}
      </footer>
    </section>
  </div>;
}
