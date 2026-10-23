import Link from "next/link";
import {
  WORK_OS_WORKSPACE_FIELD,
  WORK_OS_WORKSPACE_HOME,
  WORK_OS_WORKSPACE_NEXT_FIELD,
  WORK_OS_WORKSPACE_ROUTE,
  workOsWorkspaceRoleLabel,
  type WorkOsWorkspaceChoice,
} from "./workspace";

/**
 * The explicit workspace chooser.
 *
 * Presentational on purpose: the server page owns authentication and the
 * account's own membership list, and the desktop connect screen can render the
 * same rows. Every row is a plain POST so choosing works before hydration.
 */
export default function WorkspaceChooser({
  workspaces,
  currentOrganizationId = null,
  next = WORK_OS_WORKSPACE_HOME,
  error = null,
}: {
  workspaces: WorkOsWorkspaceChoice[];
  currentOrganizationId?: string | null;
  next?: string;
  error?: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-9.5rem)] w-full max-w-xl items-center px-4 py-10 sm:px-6">
      <section
        data-work-os-workspace=""
        className="w-full rounded-[18px] border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-md)] sm:p-8"
      >
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Work OS</p>
        <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-[var(--text-primary)]">Choose a workspace</h1>
        <p className="mt-2 max-w-md text-[13px] leading-6 text-[var(--text-secondary)]">
          You belong to more than one workspace. Pick the one you want to open. You can switch later from the workspace header.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-xl border px-3.5 py-2.5 text-[12px] leading-5 text-[var(--text-primary)]"
            style={{
              borderColor: "color-mix(in srgb, var(--status-error) 42%, var(--border))",
              background: "color-mix(in srgb, var(--status-error) 7%, var(--bg-card))",
            }}
          >
            {error}
          </p>
        ) : null}

        {workspaces.length ? (
          <ul className="mt-6 grid gap-2">
            {workspaces.map((workspace) => {
              const current = workspace.organizationId === currentOrganizationId;
              return (
                <li key={workspace.organizationId}>
                  <form method="post" action={WORK_OS_WORKSPACE_ROUTE}>
                    <input type="hidden" name={WORK_OS_WORKSPACE_FIELD} value={workspace.organizationId} />
                    <input type="hidden" name={WORK_OS_WORKSPACE_NEXT_FIELD} value={next} />
                    <button
                      type="submit"
                      aria-label={`Open ${workspace.name}`}
                      className="flex w-full items-center justify-between gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3 text-left transition hover:border-[var(--border-hot)] hover:bg-[var(--bg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold text-[var(--text-primary)]">{workspace.name}</span>
                        <span className="mt-0.5 block text-[11px] leading-5 text-[var(--text-tertiary)]">
                          {workOsWorkspaceRoleLabel(workspace.role)} workspace
                          {current ? " · Current" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold text-[var(--accent-deep)]">Open</span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-6 rounded-xl border border-[var(--border)] px-4 py-3 text-[12px] leading-5 text-[var(--text-secondary)]">
            No Work OS workspace is available to this account. {" "}
            <Link href={WORK_OS_WORKSPACE_HOME} className="font-semibold text-[var(--text-primary)] underline underline-offset-4">
              Return to Work OS
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
