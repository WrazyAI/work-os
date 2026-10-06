import type { SidebarView } from "./SidebarNav";

/**
 * First-visit page guides.
 *
 * The five workspace pages each carry one short guide. Flags are per account
 * (`work_org_members.ui_state` through `/api/work-os/me/guides`) so a guide
 * opens once wherever the employee signs in, and the header `?` replays it on
 * demand. The evidence view has no sidebar destination and therefore no guide.
 */
export const GUIDE_VIEWS = ["day", "tasks", "review", "insights", "settings"] as const;
export type GuideView = (typeof GUIDE_VIEWS)[number];

export interface GuideState {
  guides: Partial<Record<GuideView, string>>;
  autoOpen: boolean;
}

/** Last-known server state, cached in the vault so a restart while offline
 * never re-opens a guide the employee already saw. */
export interface CachedGuideState {
  organizationId: string;
  savedAt: string;
  state: GuideState;
  /** Set while an opt-out/in has not reached the server yet. */
  pendingAutoOpen: boolean | null;
}

export const EMPTY_GUIDE_STATE: GuideState = { guides: {}, autoOpen: true };

const GUIDE_VIEW_SET = new Set<string>(GUIDE_VIEWS);

export function isGuideView(value: unknown): value is GuideView {
  return typeof value === "string" && GUIDE_VIEW_SET.has(value);
}

/** Unknown views, malformed values, and non-object payloads are dropped; a
 * missing `autoOpen` keeps the historical default (automatic guides on). */
export function normalizeGuideState(raw: unknown): GuideState {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const stored = row.guides && typeof row.guides === "object" && !Array.isArray(row.guides)
    ? (row.guides as Record<string, unknown>)
    : {};
  const guides: Partial<Record<GuideView, string>> = {};
  for (const guideView of GUIDE_VIEWS) {
    const value = stored[guideView];
    if (typeof value === "string" && value.trim()) guides[guideView] = value;
  }
  return { guides, autoOpen: row.autoOpen !== false };
}

/** A guide auto-opens only while automatic guides are on and this page's guide
 * has never been shown on the account. */
export function guideAutoOpens(state: GuideState, view: GuideView): boolean {
  return state.autoOpen !== false && !state.guides[view];
}

export type GuideDecision =
  /** Nothing to decide yet (flags unknown, no page, or already evaluated). */
  | { action: "wait" }
  /** This visit's one chance is spent: seen, opted out, or blocked. */
  | { action: "skip" }
  | { action: "schedule"; view: GuideView };

/** The auto-open decision for one page visit. "skip" ends this visit's chance
 * (the guide is not marked seen), "wait" leaves the decision open until flags
 * load or the next page change. */
export function decideGuideOpen(options: {
  enabled: boolean;
  trusted: boolean;
  activeView: GuideView | null;
  evaluatedView: string | null;
  blocked: boolean;
  state: GuideState;
}): GuideDecision {
  if (!options.enabled || !options.trusted || !options.activeView) return { action: "wait" };
  if (options.evaluatedView === options.activeView) return { action: "wait" };
  if (options.blocked || !guideAutoOpens(options.state, options.activeView)) return { action: "skip" };
  return { action: "schedule", view: options.activeView };
}

/** Merge the cached local record into the server record at load: local-only
 * seen marks are pushed back (a write may have landed offline), and a local
 * opt-out/in preference that never reached the server is retried. */
export function reconcileGuideState(
  server: GuideState,
  cache: CachedGuideState | null,
  organizationId: string,
): { state: GuideState; pushGuides: GuideView[]; pushAutoOpen: boolean | null } {
  if (!cache || cache.organizationId !== organizationId) {
    return { state: server, pushGuides: [], pushAutoOpen: null };
  }
  const guides = { ...server.guides };
  const pushGuides: GuideView[] = [];
  for (const guideView of GUIDE_VIEWS) {
    const localSeen = cache.state.guides[guideView];
    if (!guides[guideView] && typeof localSeen === "string" && localSeen.trim()) {
      guides[guideView] = localSeen;
      pushGuides.push(guideView);
    }
  }
  let autoOpen = server.autoOpen;
  let pushAutoOpen: boolean | null = null;
  if (cache.pendingAutoOpen !== null && cache.pendingAutoOpen !== server.autoOpen) {
    autoOpen = cache.pendingAutoOpen;
    pushAutoOpen = cache.pendingAutoOpen;
  }
  return { state: { guides, autoOpen }, pushGuides, pushAutoOpen };
}

/** Narrow a sidebar view to a guided one; the workspace header uses this so an
 * unguided destination never shows or opens a guide. */
export function guideViewForSidebar(view: SidebarView): GuideView | null {
  return isGuideView(view) ? view : null;
}
