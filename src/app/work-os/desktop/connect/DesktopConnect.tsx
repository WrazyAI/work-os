"use client";

import { useState } from "react";
import { Check, Monitor, X } from "lucide-react";

export default function DesktopConnect({ challenge, state, redirectUri }: { challenge: string; state: string; redirectUri: string }) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState("");
  const valid = challenge.length >= 43 && state.length >= 16 && redirectUri === "wrazy-workos://auth";

  async function approve() {
    setStatus("working");
    setError("");
    const response = await fetch("/api/work-os/desktop/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge, state, redirect_uri: redirectUri }),
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
        {!valid && <p role="alert" className="mt-5 border-l-2 border-[var(--status-error)] pl-3 text-sm leading-6 text-[var(--status-error)]">This authorization request is invalid. Return to the desktop app and try again.</p>}
        {error && <p role="alert" className="mt-5 border-l-2 border-[var(--status-error)] pl-3 text-sm leading-6 text-[var(--status-error)]">{error}</p>}
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => window.close()} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-hot)] px-4 text-sm font-medium text-[var(--text-primary)] transition hover:-translate-y-0.5 hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
            <X className="size-4" /> Cancel
          </button>
          <button type="button" onClick={approve} disabled={!valid || status === "working"} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--r-sm)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--text-inverse)] shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-hover)] hover:shadow-[var(--shadow-md)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:transform-none disabled:opacity-50">
            <Check className="size-4" /> {status === "working" ? "Connecting..." : "Authorize"}
          </button>
        </div>
      </section>
    </main>
  );
}
