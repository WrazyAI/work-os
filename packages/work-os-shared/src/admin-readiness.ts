/** Client-facing setup fields. Keep this structural contract independent of
 * server evaluators and their Node/Next alias imports (the companion consumes
 * it directly). The authenticated endpoint returns the fuller report. */
export interface AdminReadiness {
  status: "ready" | "needs_setup" | "blocked";
  issues: Array<{ code: string; severity: "needs_setup" | "blocked"; count: number; message: string }>;
  checks: {
    people: { active: number };
    organization: { activeTeams: number };
    tasks: { open: number };
  };
}

/** Nested under Overview so an explicit section refresh refreshes setup too.
 * No interval: revalidate on stale mount/focus/reconnect or a setup write. */
export function readinessQueryOptions<T extends AdminReadiness>(fetchReport: () => Promise<T>) {
  return {
    queryKey: ["work-os", "admin", "overview", "readiness"] as const,
    queryFn: fetchReport,
    staleTime: 5 * 60_000,
    refetchInterval: false as const,
  };
}

export function readinessAttention(readiness: Pick<AdminReadiness, "issues"> | null | undefined) {
  const count = (readiness?.issues ?? []).filter((issue) => issue.severity === "blocked")
    .reduce((total, issue) => total + issue.count, 0);
  return count ? [{
    code: "readiness_blocked",
    severity: "error" as const,
    count,
    message: `${count} configuration blocker${count === 1 ? "" : "s"} prevent${count === 1 ? "s" : ""} the full employee workflow`,
    href: "/work-os/admin/settings",
  }] : [];
}
