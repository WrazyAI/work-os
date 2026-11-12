"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Download, X } from "lucide-react";

/**
 * The one-time first-run reminder on Today. It does not gate the workspace:
 * the employee can close it, keep working, and finish setup from the persistent
 * inline notice. The primary path is the desktop companion; the secondary path
 * is the web Settings form, which now carries the same work-profile step.
 */
export default function OnboardingSetupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);

  // Keep the latest close handler without writing the ref during render; the
  // dialog's key listener is installed once per open and reads this ref.
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-onboarding-primary]")?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="presentation">
      <button type="button" aria-label="Close setup reminder" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" tabIndex={-1} />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-setup-title"
        aria-describedby="onboarding-setup-body"
        tabIndex={-1}
        className="relative grid w-full max-w-[440px] gap-4 rounded-2xl border p-6 shadow-2xl"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Setup required</p>
            <h2 id="onboarding-setup-title" className="mt-1 text-[18px] font-semibold leading-6 text-[var(--text-primary)]">Finish setting up your workspace</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup reminder"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-tertiary)] transition hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-deep)]"
          >
            <X size={15} />
          </button>
        </header>
        <p id="onboarding-setup-body" className="text-[12px] leading-5 text-[var(--text-secondary)]">
          Your work profile and companion connection are still needed. Finish setup in the desktop app, or complete your work profile here in Settings.
        </p>
        <div className="grid gap-2">
          <Link
            data-onboarding-primary
            href="/work-os/downloads"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border px-3 text-[11px] font-semibold transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-deep)]"
            style={{ borderColor: "var(--signal)", background: "var(--signal)", color: "var(--signal-ink)" }}
          >
            <Download size={13} aria-hidden /> Download the desktop app
          </Link>
          <Link
            href="/work-os/settings"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-[10px] border px-3 text-[11px] font-semibold transition hover:bg-[var(--bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-deep)]"
            style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-primary)" }}
          >
            Review setup
          </Link>
        </div>
        <p className="text-[10px] leading-4 text-[var(--text-tertiary)]">You can do this later. The setup reminder stays on Today until it is complete.</p>
      </section>
    </div>
  );
}
