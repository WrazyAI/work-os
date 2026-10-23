"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftRight, Building2 } from "lucide-react";
import WorkOsViewModeForm from "../WorkOsViewModeForm";

export interface EmployeeWorkspaceAccess {
  role: "employee" | "manager" | "admin";
  personId: string | null;
  featureFlags: Record<string, boolean>;
  organizationName: string;
  canSwitchWorkspaces: boolean;
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
 * strip is the workspace switch for a mapped administrator working in My
 * workspace: one quiet control back to Administration.
 */
export default function EmployeeWorkspaceShell({ access, children }: { access: EmployeeWorkspaceAccess; children: ReactNode }) {
  return (
    <EmployeeWorkspaceProvider access={access}>
      <div data-work-os-workspace="" className="min-h-[calc(100vh-6rem)] bg-[var(--bg-primary)]">
        <div className="mx-auto w-full max-w-[1240px] px-6 py-8 md:px-10 md:py-10">
          {access.role === "admin" || access.canSwitchWorkspaces ? (
            <div
              className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5"
              style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
            >
              <span className="flex min-w-0 items-center gap-2 text-[11px] font-semibold text-[var(--text-tertiary)]">
                <Building2 size={13} aria-hidden />
                <span className="truncate">{access.organizationName}</span>
                {access.role === "admin" ? <span className="shrink-0">· Your employee workspace</span> : null}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {access.canSwitchWorkspaces ? (
                  <Link
                    href="/work-os/select-workspace"
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    Switch workspace
                  </Link>
                ) : null}
                {access.role === "admin" ? (
                  <WorkOsViewModeForm
                    mode="admin"
                    next="/work-os/admin"
                    formClassName="inline-flex"
                    buttonClassName="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                    title="Open the administration workspace"
                    ariaLabel="Switch to Administration"
                  >
                    <ArrowLeftRight size={13} aria-hidden /> Switch to Administration
                  </WorkOsViewModeForm>
                ) : null}
              </span>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </EmployeeWorkspaceProvider>
  );
}
