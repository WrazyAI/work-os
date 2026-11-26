import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import { ADMIN_OVERVIEW_STALE_KEY, overviewStaleMessage } from "./adminNotifications";
import { adminKeys, adminReadinessQueryOptions, fetchAdminOverview, normalizeAdminOverview, todayIso } from "./data";
import { readinessAttention } from "@wrazy/work-os-shared/admin-readiness";
import { AdminButton, Notice } from "./ui";
import OverviewSignal, { OverviewSignalSkeleton } from "./OverviewSignal";
import type { AdminOverview, AdminSection, AdminSectionFocus } from "./types";

export default function OverviewPage({ onOpenSection, onOpenPerson, onOpenRecaps }: {
  onOpenSection: (section: AdminSection, focus?: AdminSectionFocus) => void;
  onOpenPerson: (personId: string) => void;
  onOpenRecaps: () => void;
}) {
  const notifications = useNotifications();
  const readiness = useQuery(adminReadinessQueryOptions());
  const overview = useQuery<AdminOverview>({
    queryKey: adminKeys.overview(todayIso()),
    queryFn: () => fetchAdminOverview(),
    // The cache can hold a record a previous build persisted; the page reads
    // the normalized shape either way.
    select: normalizeAdminOverview,
    staleTime: 30_000,
    // The dashboard's one deliberate poll: every 60 seconds while the window
    // is focused, so a hidden window never revalidates the snapshot unseen.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // A snapshot that stopped refreshing is a standing condition the page cannot
  // otherwise show: one persistent card under a stable key, cleared when a
  // fresh snapshot lands.
  const generatedAt = overview.data?.generatedAt ?? null;
  useEffect(() => {
    const message = overviewStaleMessage(generatedAt);
    if (!message) {
      notifications.clearPersistent(ADMIN_OVERVIEW_STALE_KEY);
      return;
    }
    notifications.persistent(ADMIN_OVERVIEW_STALE_KEY, message, "Overview snapshot is stale", "info");
  }, [generatedAt, notifications]);

  if (overview.isLoading) return <OverviewSignalSkeleton />;
  if (overview.error || !overview.data) {
    return (
      <Notice tone="err">
        The workspace overview could not be loaded.
        <AdminButton variant="ghost" icon={RefreshCw} onClick={() => void overview.refetch()}>Retry</AdminButton>
      </Notice>
    );
  }

  const data = overview.data;
  const attention = [
    ...data.attention.filter((item) => item.code !== "readiness_blocked"),
    ...readinessAttention(readiness.data),
  ];

  return (
    <OverviewSignal
      data={data}
      attention={attention}
      readiness={{
        pending: readiness.isPending,
        error: readiness.isError,
        onRetry: () => void readiness.refetch(),
      }}
      onOpenSection={onOpenSection}
      onOpenPerson={onOpenPerson}
      onOpenRecaps={onOpenRecaps}
    />
  );
}
