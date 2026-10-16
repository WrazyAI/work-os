export type BootSurface = "connect" | "onboarding" | "admin" | "workspace";
export type BootScreen =
  | { kind: "loading"; phase: "vault" | "day" }
  | { kind: "failed" }
  | { kind: "content"; surface: BootSurface };

/** Exact stage copy; the apostrophe is U+2019 exactly as today. */
export const BOOT_STAGE_COPY = {
  vault: "Opening this device’s saved session",
  day: "Reading your schedule and workday",
} as const;

export interface BootState {
  vault: "pending" | "failed" | "opened";
  hasSession: boolean;
  adminReady: boolean;
  onboarding: { onboardingRequired: boolean } | null;
  dayReady: boolean;
  dayFailed: boolean;
}

/** Which surface boot is showing. Order mirrors App.tsx's gate chain, with the
 * First Light hold (design spec §4.1) added before the workspace resolves:
 * the boot overlay exits only once the workspace will render real content. */
export function resolveBootScreen(state: BootState): BootScreen {
  if (state.vault === "pending") return { kind: "loading", phase: "vault" };
  if (state.vault === "failed") return { kind: "failed" };
  if (!state.hasSession) return { kind: "content", surface: "connect" };
  if (!state.onboarding) return { kind: "loading", phase: "day" };
  if (state.onboarding.onboardingRequired) return { kind: "content", surface: "onboarding" };
  if (state.adminReady) return { kind: "content", surface: "admin" };
  // §4.1 hold: the workspace exits boot only once it will render real content.
  if (!state.dayReady && !state.dayFailed) return { kind: "loading", phase: "day" };
  return { kind: "content", surface: "workspace" };
}

/** ".workspace boot-rise" only through a loading→content handoff; "" otherwise. */
export function bootRiseClass(previous: BootScreen["kind"] | null, current: BootScreen["kind"]): string {
  return previous === "loading" && current === "content" ? "workspace boot-rise" : "workspace";
}
