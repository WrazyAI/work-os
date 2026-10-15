import type { SidebarView } from "./SidebarNav";
import type { AdminSection } from "./admin/types";

/**
 * First-visit page guides.
 *
 * The five employee workspace pages each carry one short guide, and the seven
 * administration sections carry their own set: different surfaces, different
 * copy, and different flags, so dismissing the employee Tasks guide never
 * consumes the administration Tasks guide. Flags are per account
 * (`work_org_members.ui_state` through `/api/work-os/me/guides`) so a guide
 * opens once wherever the account signs in, and the header `?` replays it on
 * demand. The employee evidence view has no sidebar destination and therefore
 * no guide of its own; administration reads evidence from its own section.
 *
 * Keys stay lowercase with underscores because the server's member-state RPC
 * owns them, and its key check only accepts `[a-z][a-z0-9_]*`.
 */
export const EMPLOYEE_GUIDE_VIEWS = ["day", "tasks", "review", "insights", "settings"] as const;
export const ADMIN_GUIDE_VIEWS = [
  "admin_overview",
  "admin_people",
  "admin_tasks",
  "admin_review",
  "admin_insights",
  "admin_evidence",
  "admin_settings",
] as const;
/** Every guided page, employee and administration alike. */
export const GUIDE_VIEWS = [...EMPLOYEE_GUIDE_VIEWS, ...ADMIN_GUIDE_VIEWS] as const;
export type EmployeeGuideView = (typeof EMPLOYEE_GUIDE_VIEWS)[number];
export type AdminGuideView = (typeof ADMIN_GUIDE_VIEWS)[number];
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
const EMPLOYEE_GUIDE_VIEW_SET = new Set<string>(EMPLOYEE_GUIDE_VIEWS);
const ADMIN_GUIDE_VIEW_SET = new Set<string>(ADMIN_GUIDE_VIEWS);

export function isGuideView(value: unknown): value is GuideView {
  return typeof value === "string" && GUIDE_VIEW_SET.has(value);
}

export function isEmployeeGuideView(value: unknown): value is EmployeeGuideView {
  return typeof value === "string" && EMPLOYEE_GUIDE_VIEW_SET.has(value);
}

export function isAdminGuideView(value: unknown): value is AdminGuideView {
  return typeof value === "string" && ADMIN_GUIDE_VIEW_SET.has(value);
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

/** Record an acknowledgement without changing an existing first-seen time. */
export function markGuideSeen(state: GuideState, view: GuideView, seenAt: string): GuideState {
  if (state.guides[view]) return state;
  return {
    ...state,
    guides: { ...state.guides, [view]: seenAt },
  };
}

/** Server writes return whole-state snapshots. Keep local seen marks monotonic
 * so an older response can never resurrect a dismissed guide. While an
 * auto-open preference is pending, that local value also remains authoritative. */
export function mergeGuideServerState(
  current: GuideState,
  incoming: GuideState,
  pendingAutoOpen: boolean | null,
): GuideState {
  return {
    guides: { ...incoming.guides, ...current.guides },
    autoOpen: pendingAutoOpen ?? current.autoOpen,
  };
}

/** Chain preference writes in call order so rapid toggles cannot arrive at the
 * server out of order and leave an older choice as the durable value. A failed
 * write does not poison the queue; the next local choice still gets a chance. */
export function queueGuidePreferenceWrite(
  tail: Promise<void>,
  write: () => Promise<void>,
): Promise<void> {
  return tail.catch(() => undefined).then(write);
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

/** The administration sections were named to read well on their own; their
 * guide keys are the same names under an `admin_` prefix, so a flag can never
 * be mistaken for an employee page's. */
const ADMIN_GUIDE_FOR_SECTION: Record<AdminSection, AdminGuideView> = {
  overview: "admin_overview",
  people: "admin_people",
  tasks: "admin_tasks",
  review: "admin_review",
  insights: "admin_insights",
  evidence: "admin_evidence",
  settings: "admin_settings",
};

const ADMIN_SECTION_FOR_GUIDE: Record<AdminGuideView, AdminSection> = {
  admin_overview: "overview",
  admin_people: "people",
  admin_tasks: "tasks",
  admin_review: "review",
  admin_insights: "insights",
  admin_evidence: "evidence",
  admin_settings: "settings",
};

/** The guide that answers for an administration section. */
export function guideViewForAdminSection(section: AdminSection): AdminGuideView {
  return ADMIN_GUIDE_FOR_SECTION[section];
}

/** Where an administration guide belongs; null for employee views, so the
 * tour's navigation can tell the two workspaces apart. */
export function adminSectionForGuideView(view: GuideView): AdminSection | null {
  return isAdminGuideView(view) ? ADMIN_SECTION_FOR_GUIDE[view] : null;
}

/** Narrow a sidebar view to a guided one; the workspace header uses this so an
 * unguided destination (employee Evidence) never shows or opens a guide. */
export function guideViewForSidebar(view: SidebarView): EmployeeGuideView | null {
  return isEmployeeGuideView(view) ? view : null;
}
