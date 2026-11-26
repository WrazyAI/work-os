"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { WorkOsReadinessReport } from "@/lib/work-os-readiness";
import { adminFetch, adminKeys, type AdminOverview as AdminOverviewRecord } from "./api";
import { readinessAttention, readinessQueryOptions } from "../admin-readiness";
import AdminOverviewSignal, { AdminOverviewSignalSkeleton } from "./AdminOverviewSignal";
import { Button, Notice } from "./ui";

/** The web Overview shell: one live snapshot, the separate readiness read, and
 * the signal board that renders both. The board owns composition; the page owns
 * fetching, retry, and the readiness merge. */
export default function AdminOverviewPage() {
  const readinessQuery = useQuery(readinessQueryOptions(() => adminFetch<WorkOsReadinessReport>("/api/work-os/readiness")));
  const today = new Date().toISOString().slice(0, 10);
  const overview = useQuery<AdminOverviewRecord>({
    queryKey: adminKeys.overview(today),
    queryFn: () => adminFetch<AdminOverviewRecord>("/api/work-os/admin/overview"),
    refetchInterval: 60_000,
  });

  if (overview.isLoading) return <AdminOverviewSignalSkeleton />;
  if (overview.error || !overview.data) {
    return (
      <Notice tone="err" action={<Button size="sm" onClick={() => void overview.refetch()}><RefreshCw size={12} aria-hidden />Retry</Button>}>
        The overview could not be loaded. {(overview.error as Error | null)?.message}
      </Notice>
    );
  }

  const data = overview.data;
  const attention = [
    ...data.attention.filter((item) => item.code !== "readiness_blocked"),
    ...readinessAttention(readinessQuery.data),
  ];

  return (
    <AdminOverviewSignal
      data={data}
      attention={attention}
      readiness={{
        pending: readinessQuery.isPending,
        error: readinessQuery.isError,
        report: readinessQuery.data,
        onRetry: () => void readinessQuery.refetch(),
      }}
    />
  );
}
