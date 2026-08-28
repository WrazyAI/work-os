/**
 * Platform feature flags. Evidence remains a fully built surface (route,
 * components, APIs, and libraries stay intact) — it is only hidden from the
 * employee navigation until the manager re-introduces it. Flip
 * FEATURES.evidence to true to restore the nav entry and views.
 */
export const FEATURES = {
  evidence: false,
} as const;
