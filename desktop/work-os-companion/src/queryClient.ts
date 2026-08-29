import { QueryClient } from "@tanstack/react-query";
import { classifyRequestFailure, isSyncBypassActive } from "./api";

export const queryClient = createQueryClient();

/** Canonical query-key roots. Always build keys through these helpers. */
export const queryKeys = {
  day: ["workos", "day"] as const,
  onboarding: ["workos", "onboarding"] as const,
  taskHistory: ["workos", "tasks", "history"] as const,
  taskDetails: (taskId: string) => ["workos", "task-details", taskId] as const,
  insights: (range: string, through: string | null) => ["workos", "insights", range, through] as const,
  options: ["workos", "options"] as const,
  planHistory: (date: string) => ["workos", "plan-history", date] as const,
};

/** Cache windows per surface (ms). See docs/companion-state-caching-plan.md. */
export const staleTimes = {
  day: 60_000,
  taskHistory: 2 * 60_000,
  taskDetails: 2 * 60_000,
  insights: 15 * 60_000,
  options: 60 * 60_000,
  planHistory: 5 * 60_000,
  onboarding: 10 * 60_000,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        networkMode: "offlineFirst",
        retry: (failureCount, error) => {
          if (isSyncBypassActive()) return false;
          const failure = classifyRequestFailure(error);
          return failure.retryable && failureCount < 1;
        },
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: false,
      },
    },
  });
}
