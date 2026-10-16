"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { adminFetch, adminKeys, type SessionResponse, type SystemStatusResponse } from "./api";
import { Button, Notice, Skeleton, cx } from "./ui";

export type AdminSection = "overview" | "people" | "tasks" | "review" | "insights" | "evidence" | "settings";

const SECTION_META: Record<AdminSection, { title: string; purpose: string }> = {
  overview: { title: "Overview", purpose: "What is happening across the workspace right now." },
  people: { title: "People", purpose: "Roster, schedules, and each teammate's recent record." },
  tasks: { title: "Tasks", purpose: "The workspace task record and what is still open." },
  review: { title: "EOD Review", purpose: "Submitted end-of-day reports and the decision they need." },
  insights: { title: "Insights", purpose: "Recorded outcomes and activity context across the selected range." },
  evidence: { title: "Evidence", purpose: "Observations and output evidence, with their provenance." },
  settings: { title: "Settings", purpose: "Workspace configuration, members, and provider connections." },
};

/** One quiet status line item: a tone dot with plain text, never a pill. */
function StatusDot({ tone, children }: { tone: "ok" | "warn" | "neutral"; children: ReactNode }) {
  const color = tone === "ok" ? "var(--status-ok)" : tone === "warn" ? "var(--status-warn)" : "var(--text-tertiary)";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

/** The administration workspace frame.
 *
 * The section navigation lives in the console shell (the Work OS sidebar
 * destinations), so the frame stays a single masthead plus the page content —
 * one navigation surface at a time. `data-work-os-workspace` scopes the
 * blueprint palette (globals.css) to this workspace, matching the employee
 * destinations. */
export default function AdminShell({ section, children }: { section: AdminSection; children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useQuery<SessionResponse>({
    queryKey: ["work-os", "session"],
    queryFn: () => adminFetch<SessionResponse>("/api/work-os/session"),
    staleTime: 30_000,
  });
  const status = useQuery<SystemStatusResponse>({
    queryKey: adminKeys.status(),
    queryFn: () => adminFetch<SystemStatusResponse>("/api/work-os/status"),
    staleTime: 30_000,
    enabled: session.data?.role === "admin",
  });
  const sync = useMutation({
    mutationFn: () => adminFetch("/api/work-os/nifty/sync", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-os"] }),
  });

  useEffect(() => {
    if (session.data && session.data.role !== "admin") router.replace("/work-os");
  }, [session.data, router]);

  const meta = SECTION_META[section];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const schemaReady = status.data?.schema.ready === true;

  return (
    <div data-work-os-workspace="" className="min-h-[calc(100vh-6rem)] bg-[var(--bg-primary)]">
      <div className="mx-auto w-full max-w-[1240px] px-6 pb-16 pt-8 md:px-10 md:pt-10">
        <header>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Work OS</p>
              <h1 className="mt-1.5 text-[24px] font-semibold leading-tight tracking-[-0.025em] text-[var(--text-primary)]">
                {meta.title}
              </h1>
              <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">{meta.purpose}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {session.data?.personId ? (
                <Link
                  href="/work-os/today"
                  className="inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
                  style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
                >
                  My Day <ArrowUpRight size={13} aria-hidden />
                </Link>
              ) : null}
              <Button
                variant="secondary"
                disabled={!schemaReady || sync.isPending}
                onClick={() => sync.mutate()}
                title={schemaReady ? "Sync the Nifty task record" : "Work OS migration required before sync"}
              >
                <RefreshCw size={13} className={cx(sync.isPending && "animate-spin")} aria-hidden />
                {sync.isPending ? "Syncing…" : "Sync Nifty"}
              </Button>
              <Button
                variant="ghost"
                aria-label="Refresh this page"
                title="Refresh this page"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["work-os"] })}
              >
                <RefreshCw size={14} aria-hidden />
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-[var(--text-tertiary)]">
            <span>{today}</span>
            <span>
              {status.isLoading ? (
                "Checking workspace…"
              ) : schemaReady ? (
                <StatusDot tone="ok">Workspace ready</StatusDot>
              ) : (
                <StatusDot tone="warn">Migration required</StatusDot>
              )}
            </span>
            {status.data && schemaReady ? (
              <span>
                {status.data.nifty.canCallApi ? (
                  <StatusDot tone="ok">Nifty connected</StatusDot>
                ) : (
                  <StatusDot tone="warn">Nifty needs a connection</StatusDot>
                )}
              </span>
            ) : null}
            {sync.error ? <span style={{ color: "var(--status-error)" }}>{(sync.error as Error).message}</span> : null}
          </div>
        </header>

        <main className="mt-6">
          {session.isLoading ? (
            <div className="grid gap-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : session.error ? (
            <Notice tone="err">{(session.error as Error).message}</Notice>
          ) : session.data?.role !== "admin" ? (
            <Notice tone="warn">Administration requires a Work OS admin membership. Redirecting to My Day…</Notice>
          ) : (
            children
          )}
        </main>

        <footer className="mt-10 border-t pt-4 text-[10.5px] leading-5 text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
          Activity context is descriptive and never proves attendance, productivity, or task completion. Worktivity owns attendance; Work OS mirrors provider-confirmed state.
        </footer>
      </div>
    </div>
  );
}
