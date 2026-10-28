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
        let lastPage = page;
        let pagesRead = 1;
        // Keep every row the administrator had already mounted, not merely the
        // same count: one new arrival shifts the page boundary, so the last
        // previously loaded row can move onto the next page.
        while (previousIds.some((id) => !seen.has(id)) && lastPage.nextCursor && pagesRead < 10) {
          const next = await load({ limit: ADMIN_INBOX_PAGE_SIZE, cursor: lastPage.nextCursor });
          if (disposed || generation !== firstPageGeneration) return;
          for (const item of next.items) {
            if (seen.has(item.deliveryId)) continue;
            seen.add(item.deliveryId);
            items.push(item);
          }
          lastPage = next;
          pagesRead += 1;
        }
        const total = Math.max(page.total, previous?.total ?? 0, items.length);
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
        set({
          page: {
            ...next,
            items: [...page.items, ...appended],
            total: Math.max(next.total, page.total),
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
