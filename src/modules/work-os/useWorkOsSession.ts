"use client";

import { useQuery } from "@tanstack/react-query";
import type { WorkOsSessionInfo } from "./session";

export type { WorkOsSessionInfo } from "./session";

async function fetchSession(): Promise<WorkOsSessionInfo> {
  const response = await fetch("/api/work-os/session", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Request failed: ${response.status}`);
  return body as WorkOsSessionInfo;
}

/**
 * The caller's Work OS role, cached for the shell.
 *
 * The WrazyOS sidebar uses it to show the destinations that actually belong to
 * the signed-in role; it is disabled off the Work OS routes so the rest of the
 * console never pays for it. `retry: false` keeps a signed-out or unmapped
 * caller from hammering the endpoint.
 */
export function useWorkOsSession(enabled: boolean) {
  return useQuery<WorkOsSessionInfo>({
    queryKey: ["work-os", "session"],
    queryFn: fetchSession,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
