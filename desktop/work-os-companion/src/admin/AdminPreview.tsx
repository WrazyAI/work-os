import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setDebugSession } from "../api";
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
 * a fixture state: `?preview-admin&section=insights&state=empty`, or
 * `state=sparse` for the deliberately partial payloads the data seam must
 * normalize. With `&api=stub`, a fabricated desktop session is registered so
 * write flows (review decisions, toggles, screenshot reasons) reach the API
 * layer, where rendered QA can stub the response; without it, writes stay
 * honestly "not connected" and no request leaves the preview. This page mounts
 * the workspace alone, so shell-level surfaces cannot be exercised here; boot
 * the real shell with `?admin-shell[&overlay=whats-new|profile|guide|memory]`
 * instead (see `src/adminShell.ts`). */
export default function AdminPreview() {
  const queryClient = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("section");
  const section = SECTIONS.find((value) => value === requested) ?? "overview";
  const requestedState = params.get("state");
  const state = requestedState === "empty" ? "empty" : requestedState === "sparse" ? "sparse" : "dense";
  const stubApi = params.get("api") === "stub";
  useMemo(() => {
    seedAdminFixtures(queryClient, state);
  }, [queryClient, state]);
  useEffect(() => {
    if (!stubApi) return;
    setDebugSession({
      token: "preview-local",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      organizationId: "org-preview",
      apiBase: "",
    });
    return () => setDebugSession(null);
  }, [stubApi]);
  return (
    <AdminWorkspace
      session={PREVIEW_SESSION}
      onSwitchToEmployee={() => undefined}
      onSignOut={() => undefined}
      initialSection={section}
    />
  );
}
