"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, ChevronLeft, Pencil, Sparkles, Trash2, Wand2, X } from "lucide-react";
import {
  applyCommitmentEdits,
  buildPlanItemsFromInterpretation,
  interpretationFromResponse,
  type PlanningInterpretation,
} from "./planning";
import { fetchJson, requestId, type AnyRow, type EmployeeDayResponse } from "./model";
import { Field, Notice, PrimaryButton, QuietButton, SecondaryButton, StatusPill, inputClass, inputStyle } from "./ui";

type DraftEdits = Record<string, { title: string; objective: string; criteria: string }>;

function sessionActive(session: AnyRow | null | undefined) {
  return !!session && !["scheduled", "clocked_out"].includes(String(session.state));
}

/** Plan your day: the companion's two-view planning session on the web.
 * Input view → build → drafted view → refine/confirm, with the same server
 * contract (interpret build id, plan items merge, revision fencing). */
export default function EmployeePlanBuilder({
  open,
  day,
  seed,
  onClose,
  onSaved,
}: {
  open: boolean;
  day: EmployeeDayResponse;
  seed?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [view, setView] = useState<"compose" | "review">("compose");
  const [input, setInput] = useState(seed ?? "");
  const [loomOpen, setLoomOpen] = useState(false);
  const [loomUrl, setLoomUrl] = useState("");
  const [loomTranscript, setLoomTranscript] = useState("");
  const [interpretation, setInterpretation] = useState<PlanningInterpretation | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<DraftEdits>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refineInput, setRefineInput] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const active = sessionActive(day.session);
  const planItems = (Array.isArray(day.plan?.items) ? day.plan.items : []) as AnyRow[];

  const effectiveInterpretation = interpretation ? applyCommitmentEdits(interpretation, Object.fromEntries(Object.entries(edits).map(([id, value]) => [id, {
    title: value.title.trim(),
    objective: value.objective.trim(),
    successCriteria: value.criteria.split("\n").map((line) => line.trim()).filter(Boolean),
  }]))) : null;

  const interpret = useMutation({
    mutationFn: () => fetchJson<{ interpretation: PlanningInterpretation; build_id: string }>("/api/work-os/me/plan/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: input.trim(),
        date: day.shiftDate,
        ...(loomOpen && loomUrl.trim() ? { loom: { url: loomUrl.trim(), transcript: loomTranscript.trim() || undefined } } : {}),
      }),
    }),
    onSuccess: (result) => {
      setInterpretation(interpretationFromResponse(result));
      setAnswers({});
      setEdits({});
      setRefineInput("");
      setView("review");
    },
  });

  const refine = useMutation({
    mutationFn: () => fetchJson<{ interpretation: PlanningInterpretation; build_id: string }>("/api/work-os/me/plan/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: refineInput.trim() || input.trim() || "Refine the draft for clarity and ordering.",
        date: day.shiftDate,
        draft: interpretation
          ? { summary: interpretation.summary, commitments: interpretation.commitments.map((commitment) => ({ clientId: commitment.clientId, title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria })) }
          : undefined,
        edits: Object.entries(edits).map(([clientId, value]) => ({ clientId, title: value.title.trim(), objective: value.objective.trim(), successCriteria: value.criteria.split("\n").map((line) => line.trim()).filter(Boolean) })),
      }),
    }),
    onSuccess: (result) => {
      setInterpretation(interpretationFromResponse(result));
      setRefineInput("");
      setEditingId(null);
    },
  });

  const save = useMutation({
    mutationFn: (confirm: boolean) => {
      const canConfirm = confirm && active;
      return fetchJson<AnyRow>("/api/work-os/me/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
        body: JSON.stringify({
          shift_date: day.shiftDate,
          revision: day.plan?.revision ?? 1,
          confirm: canConfirm,
          ...(canConfirm && effectiveInterpretation?.buildId ? { build_id: effectiveInterpretation.buildId } : {}),
          freeform_intent: input.trim() || effectiveInterpretation?.rawIntent || "",
          goal_provenance: effectiveInterpretation ? "ai_draft" : "employee",
          focus_summary: effectiveInterpretation ? effectiveInterpretation.summary : null,
          ...(effectiveInterpretation ? {
            interpretation_metadata: {
              model: "work-os-plan",
              promptVersion: "work-os-plan-v1",
              interpretedAt: new Date().toISOString(),
              clarificationCount: effectiveInterpretation.clarifications.length,
              sourceContext: ["tasks", "carry_over", "previous_plan", "blockers", "recent_updates"],
              clarifications: effectiveInterpretation.clarifications,
            },
            clarification_answers: answers,
          } : {}),
          items: effectiveInterpretation ? buildPlanItemsFromInterpretation(planItems, effectiveInterpretation, answers) : [],
        }),
      });
    },
    onSuccess: (_saved, confirm) => {
      onSaved(confirm && active
        ? "Plan confirmed — today's tasks are in your workspace."
        : "Plan saved as a draft. Confirm it once you're clocked in to create the tasks.");
    },
  });

  const busy = interpret.isPending || refine.isPending || save.isPending;
  const error = interpret.error || refine.error || save.error;

  if (!open) return null;

  const hasLoom = loomOpen && !!loomUrl.trim();
  const canBuild = !!(input.trim() || hasLoom) && !busy;

  const commitmentCriteria = (clientId: string, fallback: string[]) => {
    const value = edits[clientId]?.criteria;
    return value !== undefined ? value : fallback.join("\n");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="presentation">
      <button type="button" aria-label="Close plan builder" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" tabIndex={-1} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Plan your day"
        className="relative flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex min-w-0 items-center gap-2">
            {view === "review" ? (
              <QuietButton onClick={() => setView("compose")} className="!px-2" aria-label="Back to the plan input">
                <ChevronLeft size={15} /> Back
              </QuietButton>
            ) : null}
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-[16px] font-semibold text-[var(--text-primary)]"><Sparkles size={15} style={{ color: "var(--accent-deep)" }} /> Plan your day</h2>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">
                {view === "compose" ? "Describe your intent; Otto drafts the plan for you to review." : "Review the draft, adjust it, then save or confirm it."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone={active ? "done" : "open"}>{active ? "Clocked in" : "Not clocked in"}</StatusPill>
            <SecondaryButton onClick={onClose} aria-label="Close" className="!p-2">
              <X size={15} />
            </SecondaryButton>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? <Notice tone="err" className="mb-4">{(error as Error).message}</Notice> : null}

          {view === "compose" ? (
            <div className="grid gap-4">
              <Field label="What do you want to get done?">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  rows={4}
                  maxLength={4000}
                  className={`${inputClass} resize-y`}
                  style={inputStyle}
                  placeholder="Describe the outcome you want today — appointments, tasks, blockers, anything that shapes the plan."
                  autoFocus
                />
              </Field>
              {day.access?.featureFlags?.loom_updates === true ? (
                <div className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Attach a Loom (optional)</span>
                    <button type="button" className="text-[12px] font-semibold" style={{ color: "var(--accent-deep)" }} onClick={() => setLoomOpen((value) => !value)}>
                      {loomOpen ? "Close" : "Add a recording"}
                    </button>
                  </div>
                  {loomOpen ? (
                    <div className="mt-2 grid gap-2">
                      <input
                        value={loomUrl}
                        onChange={(event) => setLoomUrl(event.target.value)}
                        placeholder="https://www.loom.com/share/…"
                        className={inputClass}
                        style={inputStyle}
                        aria-label="Loom share link"
                      />
                      <textarea
                        value={loomTranscript}
                        onChange={(event) => setLoomTranscript(event.target.value)}
                        rows={3}
                        maxLength={50000}
                        placeholder="Paste the transcript when Loom has none (optional)."
                        className={`${inputClass} resize-y`}
                        style={inputStyle}
                        aria-label="Loom transcript"
                      />
                      <p className="text-[11px] leading-5 text-[var(--text-tertiary)]">The recording only grounds the draft. Nothing is filed from it.</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {day.prompt.kind === "plan" && day.prompt.reason ? (
                <p className="text-[11px] leading-5 text-[var(--text-tertiary)]">Prompt: {day.prompt.reason}</p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Draft summary</p>
                <p className="mt-1.5 text-[14px] leading-6 text-[var(--text-primary)]">{effectiveInterpretation?.summary || "No summary was drafted."}</p>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Commitments</p>
                <ul className="mt-2 grid gap-3">
                  {(effectiveInterpretation?.commitments ?? []).map((commitment) => {
                    const editing = editingId === commitment.clientId;
                    const draft = edits[commitment.clientId];
                    return (
                      <li key={commitment.clientId} className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
                        {editing && draft ? (
                          <div className="grid gap-3">
                            <Field label="Title">
                              <input value={draft.title} onChange={(event) => setEdits((current) => ({ ...current, [commitment.clientId]: { ...current[commitment.clientId], title: event.target.value } }))} className={inputClass} style={inputStyle} />
                            </Field>
                            <Field label="Objective">
                              <textarea value={draft.objective} onChange={(event) => setEdits((current) => ({ ...current, [commitment.clientId]: { ...current[commitment.clientId], objective: event.target.value } }))} rows={2} className={`${inputClass} resize-y`} style={inputStyle} />
                            </Field>
                            <Field label="Success criteria (one per line)">
                              <textarea value={draft.criteria} onChange={(event) => setEdits((current) => ({ ...current, [commitment.clientId]: { ...current[commitment.clientId], criteria: event.target.value } }))} rows={3} className={`${inputClass} resize-y`} style={inputStyle} />
                            </Field>
                            <div className="flex justify-end">
                              <SecondaryButton onClick={() => setEditingId(null)}><Check size={13} /> Done</SecondaryButton>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--text-primary)]">{commitment.title}</p>
                              <QuietButton
                                aria-label={`Edit ${commitment.title}`}
                                onClick={() => {
                                  setEdits((current) => current[commitment.clientId] ? current : ({ ...current, [commitment.clientId]: { title: commitment.title, objective: commitment.objective, criteria: commitment.successCriteria.join("\n") } }));
                                  setEditingId(commitment.clientId);
                                }}
                              >
                                <Pencil size={13} /> Edit
                              </QuietButton>
                            </div>
                            {commitment.objective ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{commitment.objective}</p> : null}
                            {commitment.successCriteria.length ? (
                              <ul className="mt-2 grid gap-0.5">
                                {commitment.successCriteria.map((criterion) => (
                                  <li key={criterion} className="text-[11px] leading-5 text-[var(--text-tertiary)]">· {criterion}</li>
                                ))}
                              </ul>
                            ) : null}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {commitment.linkedTaskId ? <StatusPill tone="info">Linked task</StatusPill> : <StatusPill tone="open">New outcome</StatusPill>}
                              {commitment.estimatedMinutes ? <span className="text-[11px] text-[var(--text-tertiary)]">~{commitment.estimatedMinutes} min</span> : null}
                              {commitment.sourceRefs.slice(0, 2).map((source) => (
                                <span key={`${source.provider}-${source.id}`} className="text-[10px] uppercase tracking-[0.05em] text-[var(--text-tertiary)]">{source.label || `${source.provider} ${source.type}`}</span>
                              ))}
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                  {!effectiveInterpretation?.commitments.length ? (
                    <li className="text-[12px] text-[var(--text-tertiary)]">The draft did not contain any commitments. Refine it with more detail.</li>
                  ) : null}
                </ul>
              </div>

              {(effectiveInterpretation?.clarifications ?? []).length ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">A couple of questions</p>
                  <div className="mt-2 grid gap-2">
                    {effectiveInterpretation!.clarifications.map((clarification) => (
                      <label key={clarification.id} className="grid gap-1 rounded-xl border px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--status-warn) 40%, var(--border))", background: "var(--bg-primary)" }}>
                        <span className="text-[12px] font-semibold text-[var(--text-primary)]">{clarification.question}</span>
                        <span className="text-[11px] text-[var(--text-tertiary)]">{clarification.reason}</span>
                        <input
                          value={answers[clarification.id] ?? ""}
                          onChange={(event) => setAnswers((current) => ({ ...current, [clarification.id]: event.target.value }))}
                          className={`${inputClass} mt-1`}
                          style={inputStyle}
                          placeholder="Your answer"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
                <p className="text-[11px] font-semibold text-[var(--text-secondary)]">Not quite right? Tell Otto what to change and refine the draft.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={refineInput}
                    onChange={(event) => setRefineInput(event.target.value)}
                    placeholder="e.g. Move the client call first and add a budget review"
                    className={`${inputClass} min-w-[220px] flex-1`}
                    style={inputStyle}
                    aria-label="Refinement request"
                  />
                  <SecondaryButton disabled={busy || !refineInput.trim()} onClick={() => refine.mutate()}>
                    <Wand2 size={13} /> {refine.isPending ? "Refining…" : "Refine draft"}
                  </SecondaryButton>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            {view === "review" && effectiveInterpretation ? (
              <SecondaryButton
                style={{ color: "var(--status-error)" }}
                onClick={() => {
                  if (!deleteArmed) { setDeleteArmed(true); return; }
                  setInterpretation(null);
                  setEdits({});
                  setAnswers({});
                  setDeleteArmed(false);
                  setView("compose");
                }}
                disabled={busy}
              >
                <Trash2 size={13} /> {deleteArmed ? "Confirm delete" : "Delete draft"}
              </SecondaryButton>
            ) : null}
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {view === "compose"
                ? "Build drafts a review copy — nothing is filed yet."
                : active
                  ? "Confirming creates today’s tasks and subtasks."
                  : "You’re not clocked in, so this saves the plan as a draft."}
            </span>
          </div>
          <div className="flex gap-2">
            <SecondaryButton onClick={onClose} disabled={busy}>Close</SecondaryButton>
            {view === "compose" ? (
              <PrimaryButton disabled={!canBuild} onClick={() => interpret.mutate()}>
                {interpret.isPending ? "Building…" : "Build my plan"}
              </PrimaryButton>
            ) : (
              <PrimaryButton disabled={busy || !effectiveInterpretation} onClick={() => save.mutate(active)}>
                {save.isPending ? "Saving…" : active ? "Confirm plan" : "Save plan"}
              </PrimaryButton>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
