import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, Square, Volume2 } from "lucide-react";
import type { InboxPage, OttoScope, ReviewedRecap } from "../../../../src/modules/work-os/admin-otto/contracts";
import { fetchAdminOttoInbox } from "./api";
import { ADMIN_INBOX_PAGE_SIZE, createAdminInboxController, type AdminInboxController, type AdminInboxLoad } from "./inbox";
import { adminRecapWindow, adminReviewStatusLabel } from "./labels";
import type { AdminRecapPlayback } from "./AdminRecapView";

export type AdminRecapInboxProps = {
  scope: OttoScope;
  onOpenRecap: (recap: ReviewedRecap) => void;
  onListen: (recap: ReviewedRecap) => void;
  /** Optional typed transport for the local preview and component tests. */
  transport?: AdminInboxLoad;
  initialPage?: InboxPage | null;
  initialError?: string | null;
  /** A presentation fixture for a read that is refreshing over existing rows. */
  refreshing?: boolean;
  /** Mounted without a backend: render this snapshot rather than fetching. */
  previewOnly?: boolean;
  /** Changes when a delivery poll accepted a grouped arrival. The inbox
   * refreshes in place; it never changes the selected recap, steals focus, or
   * scrolls the reader. */
  refreshRevision?: number;
  playback?: AdminRecapPlayback | null;
  recapUpdates?: Record<string, ReviewedRecap>;
  controllerRef?: (controller: AdminInboxController | null) => void;
  onSnapshot?: (snapshot: ReturnType<AdminInboxController["snapshot"]>) => void;
};

function remainingLabel(page: InboxPage): string {
  const remaining = Math.max(0, page.total - page.items.length);
  return remaining > 0
    ? `Load ${Math.min(ADMIN_INBOX_PAGE_SIZE, remaining)} more`
    : "Load more";
}

/** The reviewed-recap inbox, one read-only row per delivery. */
export function AdminRecapInbox({
  scope,
  onOpenRecap,
  onListen,
  transport,
  initialPage = null,
  initialError = null,
  refreshing: refreshingFixture = false,
  previewOnly = false,
  refreshRevision = 0,
  playback = null,
  recapUpdates = {},
  controllerRef,
  onSnapshot,
}: AdminRecapInboxProps) {
  void scope;
  const load = transport ?? fetchAdminOttoInbox;
  const [controller] = useState(() => createAdminInboxController(load, initialPage));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const lastRevision = useRef(refreshRevision);

  useEffect(() => {
    controllerRef?.(controller);
    return () => controllerRef?.(null);
  }, [controller, controllerRef]);

  useEffect(() => {
    onSnapshot?.(state);
  }, [state, onSnapshot]);

  useEffect(() => {
    if (!previewOnly) void controller.refresh();
    return () => controller.dispose();
  }, [controller, previewOnly]);

  useEffect(() => {
    if (lastRevision.current === refreshRevision) return;
    lastRevision.current = refreshRevision;
    if (!previewOnly) void controller.refresh();
  }, [controller, previewOnly, refreshRevision]);

  const page = state.page;
  const presentedError = state.error ?? (page === null ? initialError : null);
  const initialLoading = state.loading && page === null && !initialError;
  const refreshing = refreshingFixture || (state.refreshing && page !== null);
  const initialFailed = !!presentedError && page === null && !initialLoading;
  const empty = page !== null && page.items.length === 0 && !state.loading && !presentedError;
  const activeIntervalId = playback?.intervalId ?? null;
  const activePlaying = playback?.status === "loading" || playback?.status === "playing";

  return (
    <section
      className="admin-otto-inbox"
      aria-label="Reviewed recap inbox"
      aria-busy={initialLoading || refreshing || state.loadingMore}
      data-state={initialLoading ? "loading" : initialFailed ? "error" : empty ? "empty" : "ready"}
    >
      <header className="admin-otto-inbox-head">
        <div>
          <h3>Reviewed recaps</h3>
          <p>
            {page
              ? `${page.total} recap${page.total === 1 ? "" : "s"} from the last 30 days`
              : "Confirmed or corrected by employees"}
          </p>
        </div>
        <button
          type="button"
          className="admin-otto-refresh"
          aria-label="Refresh reviewed recaps"
          title="Refresh reviewed recaps"
          disabled={state.loading || state.loadingMore}
          onClick={() => void controller.refresh()}
        >
          <RefreshCw size={14} aria-hidden="true" />
          <span>{refreshing ? "Refreshing" : "Refresh"}</span>
        </button>
      </header>

      {initialLoading ? (
        <div className="admin-otto-inbox-loading" role="status">
          <span className="admin-otto-skeleton" aria-hidden="true" />
          <span className="admin-otto-skeleton" aria-hidden="true" />
          <span className="admin-otto-skeleton" aria-hidden="true" />
          <p>Getting reviewed recaps…</p>
        </div>
      ) : null}

      {refreshing ? <p className="admin-otto-inbox-refreshing" role="status">Checking for new recaps…</p> : null}

      {initialFailed ? (
        <div className="admin-otto-inbox-error" role="alert">
          <p>{"Otto couldn't load the recaps."} {presentedError}</p>
          <button type="button" className="admin-otto-secondary" onClick={() => void controller.refresh()}>Try again</button>
        </div>
      ) : null}

      {empty ? (
        <div className="admin-otto-empty">
          <p>No reviewed recaps yet.</p>
          <p className="admin-otto-quiet">When someone confirms or corrects a recap, it appears here.</p>
        </div>
      ) : null}

      {page && page.items.length > 0 ? (
        <>
          {state.error ? (
            <p className="admin-otto-inbox-inline-error" role="alert">
              {state.error}
              <button type="button" onClick={() => void (state.errorAction === "loadMore" ? controller.loadMore() : controller.refresh())}>Retry</button>
            </p>
          ) : null}
          <ol className="admin-otto-inbox-list">
            {page.items.map((item) => {
              const recap = recapUpdates[item.recap.intervalId] ?? item.recap;
              const listening = activePlaying && activeIntervalId === recap.intervalId;
              return (
                <li key={item.deliveryId}>
                  <article className="admin-otto-inbox-item" aria-label={`Reviewed recap for ${recap.person.displayName}`}>
                    <header className="admin-otto-inbox-item-head">
                      <strong>{recap.person.displayName}</strong>
                      <span className={`admin-otto-review-status is-${recap.reviewStatus}`}>
                        {adminReviewStatusLabel(recap.reviewStatus)}
                      </span>
                    </header>
                    <p className="admin-otto-inbox-when">{adminRecapWindow(recap)}</p>
                    {recap.original.headline ? <p className="admin-otto-inbox-headline">{recap.original.headline}</p> : null}
                    {recap.original.detail ? <p className="admin-otto-inbox-detail">{recap.original.detail}</p> : null}
                    <p className="admin-otto-inbox-meta">
                      {item.listenedAt ? "Listened" : "Not listened"}, {item.seenAt ? "seen" : "unread"}
                    </p>
                    <footer className="admin-otto-inbox-actions">
                      <button
                        type="button"
                        className="admin-otto-secondary"
                        data-admin-recap-id={recap.intervalId}
                        data-admin-recap-action="view"
                        onClick={() => onOpenRecap(recap)}
                      >View recap</button>
                      <button
                        type="button"
                        className={`admin-otto-listen${listening ? " is-listening" : ""}`}
                        aria-label={listening ? `Stop reading the recap for ${recap.person.displayName}` : `Listen to the recap for ${recap.person.displayName}`}
                        aria-pressed={listening}
                        onClick={() => onListen(recap)}
                      >
                        {listening ? <Square size={12} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
                        {listening ? "Stop" : "Listen"}
                      </button>
                    </footer>
                  </article>
                </li>
              );
            })}
          </ol>
          <footer className="admin-otto-inbox-footer">
            <p>Showing {page.items.length} of {page.total}</p>
            {page.nextCursor ? (
              <button
                type="button"
                className="admin-otto-secondary"
                disabled={state.loadingMore}
                onClick={() => void controller.loadMore()}
              >
                {state.loadingMore ? "Loading…" : remainingLabel(page)}
              </button>
            ) : null}
          </footer>
        </>
      ) : null}
    </section>
  );
}
