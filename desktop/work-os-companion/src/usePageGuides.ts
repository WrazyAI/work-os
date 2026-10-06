import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { secureState } from "./vault";
import {
  EMPTY_GUIDE_STATE,
  decideGuideOpen,
  normalizeGuideState,
  reconcileGuideState,
  type GuideState,
  type GuideView,
} from "./guideState";

const GUIDES_ENDPOINT = "/api/work-os/me/guides";

export interface PageGuides {
  /** The page guide currently open, if any. */
  open: GuideView | null;
  autoOpen: boolean;
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
 *   and only when no other overlay owns the screen. Opening it — automatically
 *   or by hand — is what marks it seen.
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
  const evaluatedFor = useRef<string | null>(null);

  const saveCache = useCallback(async (next: GuideState, pendingAutoOpen: boolean | null) => {
    if (!organizationId) return;
    await secureState.saveGuideState({ organizationId, state: next, pendingAutoOpen });
  }, [organizationId]);

  const push = useCallback(async (body: { guide: GuideView } | { autoOpen: boolean }): Promise<GuideState | null> => {
    try {
      const next = normalizeGuideState(await apiRequest<unknown>(GUIDES_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
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
        const saved = await push({ autoOpen: reconciled.pushAutoOpen });
        if (saved && !cancelled) {
          pendingAutoOpenRef.current = null;
          await saveCache(saved, null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, organizationId, push, saveCache]);

  const openGuide = useCallback((view: GuideView) => {
    setOpen(view);
    if (stateRef.current.guides[view]) return;
    const next: GuideState = {
      ...stateRef.current,
      guides: { ...stateRef.current.guides, [view]: new Date().toISOString() },
    };
    setState(next);
    void saveCache(next, pendingAutoOpenRef.current);
    void push({ guide: view }).then((saved) => {
      if (saved) void saveCache(saved, pendingAutoOpenRef.current);
    });
  }, [push, saveCache]);

  const setAutoOpen = useCallback((value: boolean) => {
    const next: GuideState = { ...stateRef.current, autoOpen: value };
    setState(next);
    pendingAutoOpenRef.current = value;
    void saveCache(next, value);
    void push({ autoOpen: value }).then((saved) => {
      if (!saved) return;
      pendingAutoOpenRef.current = null;
      void saveCache(saved, null);
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

  const closeGuide = useCallback(() => setOpen(null), []);
  const disableAutoOpen = useCallback(() => setAutoOpen(false), [setAutoOpen]);

  return { open, autoOpen: state.autoOpen, openGuide, closeGuide, disableAutoOpen, setAutoOpen };
}
