import { useEffect, useRef, useState } from "react";
import type { AdminOttoPendingAction, AdminOttoWorkflowView, ReviewedRecap } from "../../../../src/modules/work-os/admin-otto/contracts";
import { AdminActionBatch, AdminReadCard } from "./AdminToolCards";
import { confirmAdminOttoAction, fetchAdminOttoAction, refreshAdminOttoWorkflow } from "./api";
import type { AdminRecapPlayback } from "./AdminRecapView";

export function AdminWorkflowCard({ workflow, onUpdate, onAction, onOpenRecord, onOpenRecap, onListen, playback, confirm, status, onBusyChange }: {
  workflow: AdminOttoWorkflowView;
  onUpdate: (workflow: AdminOttoWorkflowView) => void;
  onAction: (action: AdminOttoPendingAction) => void;
  confirm?: (action: AdminOttoPendingAction) => Promise<AdminOttoPendingAction>;
  status?: (action: AdminOttoPendingAction) => Promise<AdminOttoPendingAction>;
  onOpenRecord: (url: string) => void;
  onOpenRecap: (recap: ReviewedRecap) => void;
  onListen: (recap: ReviewedRecap) => void;
  playback?: AdminRecapPlayback | null;
  onBusyChange?: (busy: boolean) => void;
}) {
  const actions = workflow.steps.flatMap((step) => step.pendingAction ? [step.pendingAction] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const refresh = async (index?: number) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const updated = await refreshAdminOttoWorkflow(workflow.id, index);
      if (active.current) onUpdate(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not refresh these requests."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Requested steps" className="admin-otto-workflow">
    {workflow.steps.filter((step) => step.result).map((step) => <div key={step.index}>
      <AdminReadCard result={step.result!} onOpenRecord={onOpenRecord} onOpenRecap={onOpenRecap} onListen={onListen} playback={playback} />
    </div>)}
    {actions.length ? <AdminActionBatch actions={actions} onOpenRecord={onOpenRecord}
      onConfirm={async (action) => {
        const next = confirm ? await confirm(action)
          : { ...action, ...(await confirmAdminOttoAction(action.previewId)).action } as AdminOttoPendingAction;
        onAction({ ...next, status: next.status ?? "recorded" });
        return next;
      }} onRefresh={async (action) => {
        const next = status ? await status(action) : { ...action, ...await fetchAdminOttoAction(action.previewId) };
        onAction(next);
        return next;
      }} /> : null}
    {workflow.steps.filter((step) => step.status === "blocked" || step.status === "failed").map((step) => <section className="admin-tool-card" key={step.index} aria-label={step.label}>
      <header className="admin-tool-head"><h4>{step.label}</h4><span className="admin-tool-state">{step.status === "blocked" ? "Waiting" : "Needs attention"}</span></header>
      <div className="admin-tool-body"><p>{step.message}</p></div>
      <footer className="admin-tool-footer"><button type="button" disabled={busy} onClick={() => void refresh(step.status === "failed" ? step.index : undefined)}>
        {busy ? "Preparing…" : step.status === "blocked" ? "Review ready steps" : "Try preparing again"}
      </button></footer>
    </section>)}
    {actions.some((action) => action.status === "expired") ? <button type="button" className="admin-otto-secondary" disabled={busy} onClick={() => {
      const step = workflow.steps.find((item) => item.pendingAction?.status === "expired");
      if (step) void refresh(step.index);
    }}>Prepare a fresh preview</button> : null}
    {error ? <p className="admin-otto-error" role="alert">{error}</p> : null}
  </section>;
}
