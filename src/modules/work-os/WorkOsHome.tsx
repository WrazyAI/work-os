"use client";

import Link from "next/link";
import { RefreshCw, ShieldCheck } from "lucide-react";
import ManagerWorkOsHome from "./ManagerWorkOsHome";
import { useWorkOsSession } from "./useWorkOsSession";

/** Work OS entry for the signed-in member.
 *
 * The server dispatcher sends employees to the nested workspace routes
 * (/work-os/today …) and administrators to the administration workspace
 * (/work-os/admin) before this renders. Managers keep the team review console;
 * the remaining branches are truthful fallbacks for client-side transitions
 * and gated deep links. */
export default function WorkOsHome() {
  const session = useWorkOsSession(true);

  if (session.isLoading) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-[12px] text-[var(--text-tertiary)]">
        <RefreshCw size={18} className="animate-spin" aria-label="Loading your workspace" />
      </div>
    );
  }
  if (session.error) {
    return (
      <div className="mx-auto mt-8 max-w-xl rounded-xl border px-4 py-3 text-[12.5px]" style={{ borderColor: "var(--status-error)", color: "var(--status-error)", background: "var(--bg-card)" }}>
        {(session.error as Error).message}
      </div>
    );
  }
  if (session.data?.role === "manager") return <ManagerWorkOsHome />;
  if (session.data?.role === "employee") {
    // The server dispatcher sends employees to the nested workspace routes
    // (/work-os/today …). This only renders if that gate is bypassed.
    return (
      <div className="grid min-h-[50vh] place-items-center text-[12px] text-[var(--text-tertiary)]" role="status">
        Opening your workspace…
      </div>
    );
  }
  // Administrators normally never reach this component (server redirect).
  return (
    <div className="mx-auto mt-8 max-w-xl">
      <Link
        href="/work-os/admin"
        className="inline-flex items-center gap-2 rounded-[10px] border px-4 py-3 text-[12.5px] font-semibold text-[var(--text-primary)]"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        <ShieldCheck size={15} style={{ color: "var(--accent)" }} aria-hidden />
        Open Work OS administration
      </Link>
    </div>
  );
}
