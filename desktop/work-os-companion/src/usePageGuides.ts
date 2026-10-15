import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { secureState } from "./vault";
import {
  EMPTY_GUIDE_STATE,
  decideGuideOpen,
  markGuideSeen,
  mergeGuideServerState,
  normalizeGuideState,
  queueGuidePreferenceWrite,
  reconcileGuideState,
  type GuideState,
  type GuideView,
} from "./guideState";

const GUIDES_ENDPOINT = "/api/work-os/me/guides";

export interface PageGuides {
  /** The page guide currently open, if any. */
  open: GuideView | null;
  autoOpen: boolean;
  /**
   * True once any guide has been acknowledged on this account. The first guide a
   * new workspace shows is what offers the whole-workspace tour, so the offer
   * belongs to that moment rather than to every page's first visit.
   */
  firstVisit: boolean;
  openGuide: (view: GuideView) => void;
  closeGuide: () => void;
  disableAutoOpen: () => void;
  setAutoOpen: (value: boolean) => void;
}

/**
 * First-visit page guides for the workspace.
 *
 * - Flags load once per session from `/api/work-os/me/guides` (account-scoped)
 *   and reconcile with the vault cache, so a write that landed offline is
 *   pushed on the next load.
 * - A guide auto-opens once when its page becomes active, after a short beat,
 *   and only when no other overlay owns the screen. Dismissing it acknowledges
 *   it for the account; opening by hand never consumes that acknowledgement.
 * - Opening by hand always works, even in offline bypass mode; only the
 *   automatic path and syncing are disabled there.
 */
export function usePageGuides(options: {
  enabled: boolean;
  organizationId: string | null;
  activeView: GuideView | null;
  /** True while another drawer, sheet, or modal is on screen. */
  blocked: boolean;
  delayMs?: number;
}): PageGuides {
  const { enabled, organizationId, activeView, blocked, delayMs = 800 } = options;
  const [state, setState] = useState<GuideState>(EMPTY_GUIDE_STATE);
  const [trusted, setTrusted] = useState(false);
  const [open, setOpen] = useState<GuideView | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingAutoOpenRef = useRef<boolean | null>(null);
  const autoOpenWriteVersionRef = useRef(0);
  const autoOpenWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const evaluatedFor = useRef<string | null>(null);

  const saveCache = useCallback(async (next: GuideState, pendingAutoOpen: boolean | null) => {
    if (!organizationId) return;
    await secureState.saveGuideState({ organizationId, state: next, pendingAutoOpen });
  }, [organizationId]);

  const push = useCallback(async (body: { guide: GuideView } | { autoOpen: boolean }): Promise<GuideState | null> => {
    try {
      const incoming = normalizeGuideState(await apiRequest<unknown>(GUIDES_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      const next = mergeGuideServerState(stateRef.current, incoming, pendingAutoOpenRef.current);
      stateRef.current = next;
      setState(next);
      return next;
    } catch {
      // The cached record keeps the local mark; the next load reconciles it.
      return null;
    }
  }, []);

  useEffect(() => {
    evaluatedFor.current = null;
    pendingAutoOpenRef.current = null;
    autoOpenWriteVersionRef.current = 0;
    autoOpenWriteQueueRef.current = Promise.resolve();
    setTrusted(false);
    setState(EMPTY_GUIDE_STATE);
    setOpen(null);
  }, [organizationId, enabled]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !organizationId) return;
    void (async () => {
      const cache = await secureState.guideState();
      if (cancelled) return;
      let server: GuideState | null = null;
      try {
        server = normalizeGuideState(await apiRequest<unknown>(GUIDES_ENDPOINT));
      } catch {
        server = null;
      }
      if (cancelled) return;
      if (!server) {
        // Offline, or the server predates this endpoint. The cached record is
        // last-known truth and keeps seen guides closed; without a cache there
        // is no trustworthy state, so nothing auto-opens this session.
        if (cache && cache.organizationId === organizationId) {
          setState(cache.state);
          setTrusted(true);
        }
        return;
      }
      const reconciled = reconcileGuideState(server, cache, organizationId);
      setState(reconciled.state);
      setTrusted(true);
      pendingAutoOpenRef.current = reconciled.pushAutoOpen;
      await saveCache(reconciled.state, reconciled.pushAutoOpen);
      for (const view of reconciled.pushGuides) {
        const saved = await push({ guide: view });
        if (saved && !cancelled) await saveCache(saved, pendingAutoOpenRef.current);
      }
      if (reconciled.pushAutoOpen !== null) {
        const value = reconciled.pushAutoOpen;
        const writeVersion = ++autoOpenWriteVersionRef.current;
        autoOpenWriteQueueRef.current = queueGuidePreferenceWrite(autoOpenWriteQueueRef.current, async () => {
          const saved = await push({ autoOpen: value });
          if (saved && !cancelled && autoOpenWriteVersionRef.current === writeVersion) {
            pendingAutoOpenRef.current = null;
            await saveCache(saved, null);
          }
        });
        await autoOpenWriteQueueRef.current;
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, organizationId, push, saveCache]);

  const openGuide = useCallback((view: GuideView) => {
    setOpen(view);
  }, []);

  const acknowledgeGuide = useCallback((view: GuideView) => {
    if (stateRef.current.guides[view]) return;
    const next = markGuideSeen(stateRef.current, view, new Date().toISOString());
    stateRef.current = next;
    setState(next);
    void saveCache(next, pendingAutoOpenRef.current);
    void push({ guide: view }).then((saved) => {
      if (saved) void saveCache(saved, pendingAutoOpenRef.current);
    });
  }, [push, saveCache]);

  const setAutoOpen = useCallback((value: boolean) => {
    const next: GuideState = { ...stateRef.current, autoOpen: value };
    stateRef.current = next;
    setState(next);
    pendingAutoOpenRef.current = value;
    const writeVersion = ++autoOpenWriteVersionRef.current;
    void saveCache(next, value);
    autoOpenWriteQueueRef.current = queueGuidePreferenceWrite(autoOpenWriteQueueRef.current, async () => {
      const saved = await push({ autoOpen: value });
      if (!saved || autoOpenWriteVersionRef.current !== writeVersion) return;
      pendingAutoOpenRef.current = null;
      await saveCache(saved, null);
    });
  }, [push, saveCache]);

  useEffect(() => {
    const decision = decideGuideOpen({
      enabled,
      trusted,
      activeView,
      evaluatedView: evaluatedFor.current,
      blocked,
      state,
    });
    if (decision.action === "wait") return;
    if (decision.action === "skip") {
      if (activeView) evaluatedFor.current = activeView;
      return;
    }
    const view = decision.view;
    const timer = window.setTimeout(() => {
      evaluatedFor.current = view;
      openGuide(view);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [activeView, blocked, delayMs, enabled, openGuide, organizationId, state, trusted]);

  const closeGuide = useCallback(() => {
    const closing = open;
    setOpen(null);
    if (closing) acknowledgeGuide(closing);
  }, [acknowledgeGuide, open]);
  const disableAutoOpen = useCallback(() => setAutoOpen(false), [setAutoOpen]);

  return { open, autoOpen: state.autoOpen, firstVisit: Object.keys(state.guides).length === 0, openGuide, closeGuide, disableAutoOpen, setAutoOpen };
}
