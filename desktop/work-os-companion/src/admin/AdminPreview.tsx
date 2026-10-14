import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import AdminWorkspace from "./AdminWorkspace";
import { seedAdminFixtures } from "./adminFixtures";
import type { AdminSection, SessionResponse } from "./types";

const PREVIEW_SESSION: SessionResponse = {
  organizationId: "org-preview",
  role: "admin",
  personId: "p-admin",
  userId: "user-preview",
  featureFlags: { employee_companion: true, desktop_companion: true },
};

const SECTIONS: AdminSection[] = ["overview", "people", "tasks", "review", "insights", "evidence", "settings"];

/** Dev-only rendered-QA fixture for the administration workspace: the real
 * shell and pages driven by seeded API-shaped fixtures. Deep-link a section or
 * the empty state: `?preview-admin&section=insights&state=empty`. */
export default function AdminPreview() {
  const queryClient = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("section");
  const section = SECTIONS.find((value) => value === requested) ?? "overview";
  const state = params.get("state") === "empty" ? "empty" : "dense";
  useMemo(() => {
    seedAdminFixtures(queryClient, state);
  }, [queryClient, state]);
  return (
    <AdminWorkspace
      session={PREVIEW_SESSION}
      onSwitchToEmployee={() => undefined}
      onSignOut={() => undefined}
      initialSection={section}
    />
  );
}
