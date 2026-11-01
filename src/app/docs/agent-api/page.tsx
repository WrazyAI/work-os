import type { Metadata } from "next";
import Link from "next/link";
import ApiDocs from "@/modules/work-os/employee/ApiDocs";

export const metadata: Metadata = {
  title: "Agent API",
  description: "Read the Work OS Agent API: authentication, endpoints, scopes, limits, errors, and MCP.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://app.wrazyos.com/docs/agent-api" },
};

function Mark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7.5" fill="#1b1c1f" />
      <polyline points="7.5,11 11.25,21.5 16,14.5 20.75,21.5 24.5,11" fill="none" stroke="#4fd1a8" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AgentApiDocsPage() {
  return (
    <div data-work-os-workspace="" className="min-h-screen bg-[var(--bg-primary)]">
      <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
        <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-4 px-6 py-4 md:px-10">
          <Link href="/" aria-label="WrazyOS home" className="flex min-h-10 items-center gap-2.5 text-[var(--text-primary)] no-underline">
            <Mark />
            <span className="text-xl font-semibold tracking-[-0.03em]">WrazyOS<span style={{ color: "var(--accent-deep)" }}>.</span></span>
          </Link>
          <nav aria-label="Public documentation navigation" className="flex items-center gap-4">
            <span className="hidden text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)] sm:inline">Developer docs</span>
            <Link href="/login" className="inline-flex min-h-10 items-center rounded-[10px] border px-3.5 py-2 text-[12px] font-semibold text-[var(--text-primary)] no-underline transition hover:border-[var(--border-hot)]" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1240px] px-6 py-8 md:px-10 md:py-10">
        <ApiDocs />
      </main>
      <footer className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-4 border-t px-6 py-6 text-[11px] text-[var(--text-tertiary)] md:px-10" style={{ borderColor: "var(--border)" }}>
        <span>© {new Date().getFullYear()} WrazyAI, LLC</span>
        <nav aria-label="Legal and support" className="flex flex-wrap items-center gap-5">
          <Link href="/privacy" className="hover:text-[var(--text-primary)]">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-[var(--text-primary)]">Terms of Service</Link>
          <a href="mailto:info@wrazyos.com" className="hover:text-[var(--text-primary)]">Contact</a>
        </nav>
      </footer>
    </div>
  );
}
