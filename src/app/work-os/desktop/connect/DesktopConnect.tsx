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
    <main className="min-h-screen bg-[#f5f6f8] px-5 py-16 text-[#17191c]">
      <section className="mx-auto max-w-md border border-[#d9dde3] bg-white p-7 shadow-sm">
        <Monitor className="mb-5 size-9 text-[#315f51]" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Connect Work OS Companion</h1>
        <p className="mt-3 text-sm leading-6 text-[#5b626b]">Authorize this Windows device to access your own schedule, tasks, evidence, proposals, and EOD drafts.</p>
        {!valid && <p className="mt-5 border-l-2 border-[#b42318] pl-3 text-sm text-[#b42318]">This authorization request is invalid. Return to the desktop app and try again.</p>}
        {error && <p className="mt-5 border-l-2 border-[#b42318] pl-3 text-sm text-[#b42318]">{error}</p>}
        <div className="mt-7 flex gap-3">
          <button type="button" onClick={approve} disabled={!valid || status === "working"} className="inline-flex h-10 items-center gap-2 bg-[#315f51] px-4 text-sm font-medium text-white disabled:opacity-50">
            <Check className="size-4" /> {status === "working" ? "Connecting..." : "Authorize"}
          </button>
          <button type="button" onClick={() => window.close()} className="inline-flex h-10 items-center gap-2 border border-[#cfd4da] px-4 text-sm font-medium">
            <X className="size-4" /> Cancel
          </button>
        </div>
      </section>
    </main>
  );
}
