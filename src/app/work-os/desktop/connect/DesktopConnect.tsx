"use client";

import { useState } from "react";
import { Check, Monitor, X } from "lucide-react";
import type { WorkOsWorkspaceChoice } from "@/modules/work-os/workspace";

export default function DesktopConnect({
  challenge,
  state,
  redirectUri,
  workspaces,
}: {
  challenge: string;
  state: string;
  redirectUri: string;
  workspaces: WorkOsWorkspaceChoice[];
}) {
  // A companion session is person-scoped. A workspace without a mapped person
  // cannot authorize this device, so it is not offered as a choice.
  const selectable = workspaces.filter((workspace) => Boolean(workspace.personId));
  const [organizationId, setOrganizationId] = useState(
    selectable.length === 1 ? selectable[0].organizationId : "",
  );
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState("");
  const selected = selectable.find((workspace) => workspace.organizationId === organizationId) ?? null;
  const requestValid = challenge.length >= 43 && state.length >= 16 && redirectUri === "wrazy-workos://auth";
  const canApprove = requestValid && Boolean(selected);

  async function approve() {
    if (!canApprove || !selected) return;
    setStatus("working");
    setError("");
    const response = await fetch("/api/work-os/desktop/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge,
        state,
        redirect_uri: redirectUri,
        ...(selected ? { organization_id: selected.organizationId } : {}),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error || "Could not authorize this device.");
      setStatus("error");
      return;
    }
    window.location.assign(result.callbackUrl);
  }

  return (
    <main className="flex min-h-[calc(100vh-9.5rem)] items-center justify-center bg-[var(--bg-primary)] px-4 py-10 text-[var(--text-primary)] sm:px-6">
      <section className="w-full max-w-md rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-md)] sm:p-8">
        <div className="mb-6 flex size-11 items-center justify-center rounded-[var(--r-sm)] bg-[var(--accent-subtle)] text-[var(--accent)]">
          <Monitor className="size-5" aria-hidden="true" />
        </div>
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Work OS companion</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[var(--text-primary)]">Authorize this device</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Allow this Windows companion to securely access your schedule, tasks, evidence, proposals, and EOD drafts.</p>

        {selectable.length > 1 ? (
          <div className="mt-5 grid gap-1.5">
            <label htmlFor="companion-workspace" className="text-[12px] font-semibold text-[var(--text-primary)]">Workspace</label>
            <select
              id="companion-workspace"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value)}
              className="h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-hot)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <option value="" disabled>Choose a workspace</option>
              {selectable.map((workspace) => (
                <option key={workspace.organizationId} value={workspace.organizationId}>{workspace.name}</option>
              ))}
            </select>
            <p className="text-[11px] leading-5 text-[var(--text-tertiary)]">
              This device will open the workspace you choose. You can reconnect to switch later.
              {selectable.length < workspaces.length ? " Workspaces without a mapped workday are not shown." : ""}
            </p>
          </div>
        ) : selected ? (
          <p className="mt-5 text-[12px] leading-5 text-[var(--text-tertiary)]">
            Workspace: <span className="font-semibold text-[var(--text-secondary)]">{selected.name}</span>
          </p>
        ) : null}

        {!selectable.length ? (
          <p role="alert" className="mt-5 border-l-2 border-[var(--status-error)] pl-3 text-sm leading-6 text-[var(--status-error)]">
            No Work OS workspace has a workday mapped to this account. Ask an administrator to map you before connecting this device.
          </p>
        ) : null}
        {!requestValid && (challenge || state || redirectUri) ? (
          <p role="alert" className="mt-5 border-l-2 border-[var(--status-error)] pl-3 text-sm leading-6 text-[var(--status-error)]">
            This authorization request is invalid. Return to the desktop app and try again.
          </p>
        ) : null}
        {error && <p role="alert" className="mt-5 border-l-2 border-[var(--status-error)] pl-3 text-sm leading-6 text-[var(--status-error)]">{error}</p>}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => window.close()} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-hot)] px-4 text-sm font-medium text-[var(--text-primary)] transition hover:-translate-y-0.5 hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
            <X className="size-4" /> Cancel
          </button>
          <button type="button" onClick={approve} disabled={!canApprove || status === "working"} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--r-sm)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--text-inverse)] shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-hover)] hover:shadow-[var(--shadow-md)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:transform-none disabled:opacity-50">
            <Check className="size-4" /> {status === "working" ? "Connecting..." : "Authorize"}
          </button>
        </div>
      </section>
    </main>
  );
}
