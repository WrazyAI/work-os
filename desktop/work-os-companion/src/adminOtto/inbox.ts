import type { InboxPage } from "../../../../src/modules/work-os/admin-otto/contracts";

export const ADMIN_INBOX_PAGE_SIZE = 12;

export type AdminInboxLoad = (input: { cursor?: string; limit?: number }) => Promise<InboxPage>;

export type AdminInboxSnapshot = {
  page: InboxPage | null;
  /** Any first-page read is in flight. Existing records stay visible. */
  loading: boolean;
  /** A read that will replace the first page is in flight over existing data. */
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  errorAction: "refresh" | "loadMore" | null;
};

export type AdminInboxController = {
  snapshot: () => AdminInboxSnapshot;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  dispose: () => void;
};

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The reviewed-recap inbox could not be reached.";
}

/**
 * The administration inbox's paging state.
 *
 * One explicit page is twelve rows. Refresh keeps the last good page mounted
 * until the new first page succeeds, and a newer refresh/load-more generation
 * makes a late answer harmless. Nothing loads on a timer or on mount: the
 * component calls `refresh`, and only the employee's Load more control calls
 * `loadMore`.
 */
export function createAdminInboxController(
  load: AdminInboxLoad,
  initialPage: InboxPage | null = null,
): AdminInboxController {
  let state: AdminInboxSnapshot = {
    page: initialPage,
    loading: initialPage === null,
    refreshing: false,
    loadingMore: false,
    error: null,
    errorAction: null,
  };
  let disposed = false;
  let firstPageGeneration = 0;
  let moreGeneration = 0;
  const listeners = new Set<() => void>();

  const emit = () => { for (const listener of listeners) listener(); };
  const set = (patch: Partial<AdminInboxSnapshot>) => {
    state = { ...state, ...patch };
    emit();
  };

  return {
    snapshot: () => state,
    subscribe: (listener) => {
      // StrictMode performs one mount, cleanup and mount. A real unmount has no
      // subsequent subscriber, so a late response still stays fenced; a
      // remount reopens the controller for its own effect-driven refresh.
      disposed = false;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async refresh() {
      if (disposed) return;
      const generation = ++firstPageGeneration;
      moreGeneration += 1;
      set({
        loading: true,
        refreshing: state.page !== null,
        loadingMore: false,
      });
      try {
        const page = await load({ limit: ADMIN_INBOX_PAGE_SIZE });
        if (disposed || generation !== firstPageGeneration) return;
        const previous = state.page;
        // Refresh from the top while keeping every page the administrator had
        // already loaded. Re-reading the loaded window (rather than appending
        // old rows to a newer first page) keeps the cursor contiguous and
        // prevents a shifted arrival from creating a gap or a duplicate.
        const previousIds = previous?.items.map((item) => item.deliveryId) ?? [];
        const seen = new Set(page.items.map((item) => item.deliveryId));
        const items = [...page.items];
        // The mounted window can only shift down by the rows that arrived above
        // it, so its old size plus those arrivals bounds the top-up. A removed
        // row never comes back; once a page brings none of the old rows, stop
        // instead of scanning the ten-page cap for it on every refresh.
        const previousIdSet = new Set(previousIds);
        const arrivedSince = page.items.filter((item) => !previousIdSet.has(item.deliveryId)).length;
        const retainedTarget = previousIds.length + arrivedSince;
        const missingPrevious = () => previousIds.some((id) => !seen.has(id));
        let lastPage = page;
        let pagesRead = 1;
        let pageKeptPrevious = page.items.some((item) => previousIdSet.has(item.deliveryId));
        // Keep every row the administrator had already mounted, not merely the
        // same count: one new arrival shifts the page boundary, so the last
        // previously loaded row can move onto the next page.
        while (lastPage.nextCursor && pagesRead < 10
          && (items.length < retainedTarget || (pageKeptPrevious && missingPrevious()))) {
          const next = await load({ limit: ADMIN_INBOX_PAGE_SIZE, cursor: lastPage.nextCursor });
          if (disposed || generation !== firstPageGeneration) return;
          for (const item of next.items) {
            if (seen.has(item.deliveryId)) continue;
            seen.add(item.deliveryId);
            items.push(item);
          }
          pageKeptPrevious = next.items.some((item) => previousIdSet.has(item.deliveryId));
          lastPage = next;
          pagesRead += 1;
        }
        // The server's current total wins; the number retained only prevents a
        // count that under-reports what is on screen. A shrinking server total
        // (dismissed, unfollowed, aged out) must not be carried forward.
        const total = Math.max(page.total, items.length);
        const merged = previous ? {
          ...page,
          items,
          total,
          nextCursor: items.length < total ? lastPage.nextCursor : null,
        } : page;
        set({ page: merged, loading: false, refreshing: false, error: null, errorAction: null });
      } catch (error) {
        if (disposed || generation !== firstPageGeneration) return;
        set({
          loading: false,
          refreshing: false,
          error: messageOf(error),
          errorAction: "refresh",
        });
      }
    },

    async loadMore() {
      if (disposed || state.loading || state.loadingMore) return;
      const page = state.page;
      const cursor = page?.nextCursor ?? null;
      if (!page || !cursor) return;
      const generation = ++moreGeneration;
      const firstGeneration = firstPageGeneration;
      set({ loadingMore: true });
      try {
        const next = await load({ limit: ADMIN_INBOX_PAGE_SIZE, cursor });
        if (disposed || generation !== moreGeneration || firstGeneration !== firstPageGeneration) return;
        const seen = new Set(page.items.map((item) => item.deliveryId));
        const appended = next.items.filter((item) => {
          if (seen.has(item.deliveryId)) return false;
          seen.add(item.deliveryId);
          return true;
        });
        const merged = [...page.items, ...appended];
        // A refreshed server total may have shrunk below the rows already
        // mounted. Keep the count truthful and drop Load more once the list is
        // complete instead of carrying the older, larger total forward.
        const total = Math.max(next.total, merged.length);
        set({
          page: {
            ...next,
            items: merged,
            total,
            nextCursor: merged.length < total ? next.nextCursor : null,
          },
          loadingMore: false,
          error: null,
          errorAction: null,
        });
      } catch (error) {
        if (disposed || generation !== moreGeneration) return;
        set({ loadingMore: false, error: messageOf(error), errorAction: "loadMore" });
      }
    },

    dispose() {
      disposed = true;
      firstPageGeneration += 1;
      moreGeneration += 1;
      listeners.clear();
    },
  };
}
