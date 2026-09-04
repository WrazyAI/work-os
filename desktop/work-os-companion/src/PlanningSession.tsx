import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Sparkles, X } from "lucide-react";
import type { DailyPlan } from "./types";

export type PlanningSessionState = "idle" | "drafting" | "interpreting" | "clarifying" | "reviewing" | "saving" | "confirmed" | "offline_fallback" | "ai_unavailable" | "save_error" | "conflict";
export type PlanningInterpretation = {
  rawIntent: string;
  summary: string;
  commitments: Array<{ clientId: string; linkedTaskId?: string; title: string; objective: string; successCriteria: string[]; dependency?: string; blocker?: string; estimatedMinutes?: number; sourceRefs: Array<{ provider: string; type: string; id: string; label?: string }>; confidence: number }>;
  clarifications: Array<{ id: string; commitmentId?: string; question: string; reason: string }>;
  readiness: "ready" | "needs_one_clarification" | "needs_multiple_clarifications";
};

export function PlanningSession({
  open,
  plan,
  active,
  busy,
  onClose,
  onInterpret,
  onConfirm,
}: {
  open: boolean;
  plan: DailyPlan | null;
  active: boolean;
  busy: boolean;
  onClose: () => void;
  onInterpret: (input: string) => Promise<PlanningInterpretation>;
  onConfirm: (input: string, interpretation: PlanningInterpretation | null, clarificationAnswers: Record<string, string>) => Promise<"confirmed" | "saved" | "queued" | "conflict" | "failed">;
}) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<PlanningSessionState>("idle");
  const [interpretation, setInterpretation] = useState<PlanningInterpretation | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setInput(plan?.freeform_intent ?? "");
    setInterpretation(null);
    setClarificationAnswers(plan?.clarification_answers ?? {});
    setError("");
    setState("drafting");
  }, [open, plan?.id]);

  if (!open) return null;
  const build = async () => {
    if (!input.trim()) return;
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
  const save = async () => {
    if (!input.trim()) return;
    setState("saving");
    const result = await onConfirm(input.trim(), interpretation, clarificationAnswers);
    if (result === "confirmed") { setState("confirmed"); return; }
    if (result === "conflict") { setState("conflict"); return; }
    if (result === "failed") { setState("save_error"); return; }
    setState(result === "queued" ? "offline_fallback" : "drafting");
  };

  return <div className="task-modal-backdrop planning-backdrop" role="presentation">
    <section className="planning-session" role="dialog" aria-modal="true" aria-labelledby="planning-session-title">
      <header><div><small>Today</small><h2 id="planning-session-title">Plan your day</h2></div><button aria-label="Close planning session" onClick={onClose} disabled={busy || state === "saving"}><X size={16} /></button></header>
      <div className="planning-session-body">
        <label htmlFor="planning-intent">What do you want to get done today?</label>
        <textarea id="planning-intent" autoFocus maxLength={4000} value={input} disabled={busy || state === "saving" || state === "confirmed"} onChange={(event) => { setInput(event.target.value); setInterpretation(null); if (state !== "drafting") setState("drafting"); }} placeholder="Fix the failing integration test, then get the migration ready for review." />
        <small className="planning-provenance">Your words stay attached to the plan. Work OS only suggests structure for your review.</small>
        {state === "interpreting" && <p className="planning-status"><Sparkles size={15} /> Building a reviewable plan…</p>}
        {interpretation && <section className="planning-review" aria-live="polite">
          <small>Review commitments</small><h3>{interpretation.summary}</h3>
          {interpretation.commitments.map((commitment, index) => <article key={commitment.clientId}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{commitment.title}</strong><p>{commitment.objective}</p>{commitment.successCriteria.length > 0 && <><small>Done when</small><ul>{commitment.successCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></>}</div></article>)}
          {interpretation.clarifications.length > 0 && <div className="planning-clarifications"><strong>{interpretation.clarifications.length === 1 ? "One thing to clarify" : "Two things to clarify"}</strong>{interpretation.clarifications.map((question) => <label key={question.id} htmlFor={`planning-clarification-${question.id}`}><span>{question.question}</span><textarea id={`planning-clarification-${question.id}`} maxLength={1000} value={clarificationAnswers[question.id] ?? ""} disabled={busy || state === "saving" || state === "confirmed"} onChange={(event) => setClarificationAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /></label>)}</div>}
        </section>}
        {state === "ai_unavailable" && <div className="planning-notice"><AlertTriangle size={16} /><span>{error} You can still save your own planning note.</span></div>}
        {state === "offline_fallback" && <div className="planning-notice"><AlertTriangle size={16} /><span>Your raw plan is queued locally. It is not a confirmed structured plan yet.</span></div>}
        {state === "conflict" && <div className="planning-notice"><AlertTriangle size={16} /><span>This plan changed elsewhere. Refresh before saving again.</span></div>}
        {state === "save_error" && <div className="planning-notice"><AlertTriangle size={16} /><span>Your plan was not saved. Check the connection or correct the plan and try again.</span></div>}
        {state === "confirmed" && <div className="planning-confirmed"><CheckCircle2 size={17} /><span>Your daily commitments are confirmed.</span></div>}
      </div>
      <footer>{state !== "confirmed" && <><button className="secondary" onClick={onClose} disabled={busy || state === "saving"}>Close</button><button className="secondary" onClick={() => void build()} disabled={!input.trim() || busy || state === "saving"}>Build my plan</button><button className="primary" onClick={() => void save()} disabled={!input.trim() || busy || state === "saving" || Boolean(interpretation?.clarifications.some((question) => !clarificationAnswers[question.id]?.trim()))}>{active ? "Confirm my day" : "Save planning note"}</button></>}{state === "confirmed" && <button className="primary" onClick={onClose}>Continue working</button>}</footer>
    </section>
  </div>;
}
