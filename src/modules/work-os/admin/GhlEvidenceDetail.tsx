"use client";

import { useState } from "react";
import { Button, Notice } from "./ui";
import { isApprovedGhlSourceUrl } from "@/lib/work-os-ghl-evidence-view";

interface EmailResponse {
  text: string | null;
  excerpt: string | null;
  availability: "available" | "unavailable" | "expired";
  sourceUrl: string | null;
  truncated: boolean;
}

/** One explicit full-email request. Text stays in component memory and is
 * cleared when the event changes or the drawer closes. */
export default function GhlEvidenceDetail({ eventId, excerpt, sourceUrl }: { eventId: string; excerpt: string | null; sourceUrl: string | null }) {
  const [email, setEmail] = useState<EmailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadEmail() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/work-os/evidence/${encodeURIComponent(eventId)}/ghl-email`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as EmailResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
      setEmail(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The full email could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const approvedSource = isApprovedGhlSourceUrl(sourceUrl) ? sourceUrl : null;
  return (
    <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}>
      <p className="text-[12px] font-semibold text-[var(--text-primary)]">Supporting email</p>
      <p className="mt-0.5 text-[11px] leading-5 text-[var(--text-tertiary)]">
        The retained excerpt is available with the evidence. Opening the full email fetches it on demand and is recorded in the audit log.
      </p>
      {excerpt ? <p className="mt-2 whitespace-pre-wrap text-[11.5px] leading-5 text-[var(--text-secondary)]">{excerpt}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={loading} onClick={loadEmail}>
          {loading ? "Loading email…" : "Open full email"}
        </Button>
        {approvedSource ? (
          <a href={approvedSource} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
            Open in GHL
          </a>
        ) : (
          <span className="text-[10.5px] leading-4 text-[var(--text-tertiary)]">Exact GHL link not verified — look up this record in GHL by its identifiers.</span>
        )}
      </div>
      {error ? <div className="mt-2"><Notice tone="err">{error}</Notice></div> : null}
      {email ? (
        email.availability === "available" && email.text ? (
          <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-[11.5px] leading-5 text-[var(--text-secondary)]">{email.text}</pre>
            {email.truncated ? <p className="mt-1.5 text-[10.5px] text-[var(--text-tertiary)]">The email is truncated at the viewing limit.</p> : null}
          </div>
        ) : (
          <div className="mt-3">
            <Notice tone="warn">
              {email.availability === "expired"
                ? "Full email unavailable — the content retention window has expired. Only the permitted excerpt remains."
                : "Full email unavailable — the original source could not be loaded. The retained excerpt above is still available."}
            </Notice>
          </div>
        )
      ) : null}
    </div>
  );
}
