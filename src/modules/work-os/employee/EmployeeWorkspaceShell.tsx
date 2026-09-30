"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { ShieldHalf } from "lucide-react";

export interface EmployeeWorkspaceAccess {
  role: "employee" | "manager" | "admin";
  personId: string | null;
  featureFlags: Record<string, boolean>;
}

const EmployeeWorkspaceContext = createContext<EmployeeWorkspaceAccess | null>(null);

export function useEmployeeWorkspaceAccess(): EmployeeWorkspaceAccess {
  const value = useContext(EmployeeWorkspaceContext);
  if (!value) throw new Error("useEmployeeWorkspaceAccess must be used inside EmployeeWorkspaceShell");
  return value;
}

/** The access provider alone, so dev fixtures can render destinations with a
 * shaped access record without the full route shell. */
export function EmployeeWorkspaceProvider({ access, children }: { access: EmployeeWorkspaceAccess; children: ReactNode }) {
  return <EmployeeWorkspaceContext.Provider value={access}>{children}</EmployeeWorkspaceContext.Provider>;
}

/**
 * The employee workspace frame.
 *
 * `data-work-os-workspace` scopes the Work OS palette (globals.css) to these
 * routes so the console shell keeps its own identity around them. The admin
 * strip is the only visible difference for a mapped administrator working in
 * their own workspace: one quiet path back to Administration.
 */
export default function EmployeeWorkspaceShell({ access, children }: { access: EmployeeWorkspaceAccess; children: ReactNode }) {
  return (
    <EmployeeWorkspaceProvider access={access}>
      <div data-work-os-workspace="" className="min-h-[calc(100vh-6rem)] bg-[var(--bg-primary)]">
        <div className="mx-auto w-full max-w-[1240px] px-6 py-8 md:px-10 md:py-10">
          {access.role === "admin" ? (
            <div
              className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5"
              style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
            >
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                <ShieldHalf size={13} /> Your employee workspace
              </span>
              <Link href="/work-os/admin" className="text-[12px] font-semibold underline-offset-2 hover:underline" style={{ color: "var(--accent-deep)" }}>
                Administration
              </Link>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </EmployeeWorkspaceProvider>
  );
}
