import { describe, expect, it, vi } from "vitest";
import type { InboxPage } from "../../../../src/modules/work-os/admin-otto/contracts";
import { createAdminInboxController } from "./inbox";
import { fixtureInboxPage } from "./fixtures";

const page = { items: [], nextCursor: "next", total: 24, asOf: "2026-10-26T12:00:00Z", coverage: [], unread: 24, catchupPending: false };

describe("admin inbox controller", () => {
  it("inbox_pages_twelve_and_refresh_retains_records_until_success", async () => {
    let finish!: (value: typeof page) => void;
    const load = vi.fn().mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const controller = createAdminInboxController(load);
    await controller.refresh();
    const refresh = controller.refresh();
    expect(controller.snapshot().page).toBe(page);
    expect(controller.snapshot().loading).toBe(true);
    expect(load).toHaveBeenLastCalledWith({ limit: 12 });
    finish({ ...page, total: 25 }); await refresh;
    expect(controller.snapshot().page?.total).toBe(25);
    controller.dispose();
  });

  it("inbox_stale_scope_response_cannot_publish_after_disposal", async () => {
    let finish!: (value: InboxPage) => void;
    const controller = createAdminInboxController(() => new Promise<InboxPage>((resolve) => { finish = resolve; }));    const read = controller.refresh(); controller.dispose();
    finish(fixtureInboxPage({ count: 0, total: 99, nextCursor: null, unread: 0 })); await read;
    expect(controller.snapshot().page).toBe(null);
  });

  it("appends one explicit contiguous page and keeps the server's complete total", async () => {
    const first = fixtureInboxPage({ count: 12, total: 25, nextCursor: "cursor-2" });
    const second = fixtureInboxPage({ count: 12, total: 25, nextCursor: null, offset: 12 });
    const load = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const controller = createAdminInboxController(load);
    await controller.refresh();
    await controller.loadMore();
    const state = controller.snapshot();
    expect(load).toHaveBeenLastCalledWith({ limit: 12, cursor: "cursor-2" });
    expect(state.page?.items).toHaveLength(24);
    expect(state.page?.total).toBe(25);
    expect(state.page?.nextCursor).toBe(null);
    // The first page's records stay mounted in their original order.
    expect(state.page?.items[0]).toBe(first.items[0]);
    expect(state.page?.items[12]).toBe(second.items[0]);
    controller.dispose();
  });

  it("never auto-loads: mounting leaves the page in its initial loading state", () => {
    const load = vi.fn();
    const controller = createAdminInboxController(load);
    expect(controller.snapshot().loading).toBe(true);
    expect(load).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps the last good page and names the failure on refresh", async () => {
    const first = fixtureInboxPage({ count: 2, total: 2, nextCursor: null });
    const load = vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error("The workspace is offline."));
    const controller = createAdminInboxController(load);
    await controller.refresh();
    await controller.refresh();
    expect(controller.snapshot().page).toBe(first);
    expect(controller.snapshot().error).toContain("offline");
    expect(controller.snapshot().loading).toBe(false);
    // A retry clears the previous failure only when it succeeds.
    load.mockResolvedValueOnce({ ...first, total: 3 });
    await controller.refresh();
    expect(controller.snapshot().error).toBe(null);
    expect(controller.snapshot().page?.total).toBe(3);
    controller.dispose();
  });

  it("arrival refresh keeps both loaded pages, dedupes and preserves a contiguous cursor", async () => {
    const first = fixtureInboxPage({ count: 12, total: 25, nextCursor: "cursor-2" });
    const second = fixtureInboxPage({ count: 12, total: 25, nextCursor: "cursor-3", offset: 12 });
    const newArrival = {
      ...fixtureInboxPage({ count: 1, total: 26, nextCursor: "cursor-refresh" }).items[0],
      deliveryId: "99999999-9999-4999-8999-999999999999",
    };
    const refreshedFirst = {
      ...fixtureInboxPage({ count: 12, total: 26, nextCursor: "cursor-refresh" }),
      items: [newArrival, ...first.items.slice(0, 11)],
      unread: 4,
    };
    // The new arrival shifts every old row down one. A top-up refresh must
    // follow the server cursors until the previously loaded count is restored.
    const refreshedSecond = fixtureInboxPage({ count: 12, total: 26, nextCursor: "cursor-after-22", offset: 11 });
    const refreshedThird = fixtureInboxPage({ count: 1, total: 26, nextCursor: "cursor-after-23", offset: 23 });
    const refreshedFourth = fixtureInboxPage({ count: 1, total: 26, nextCursor: null, offset: 24 });
    const load = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(refreshedFirst)
      .mockResolvedValueOnce(refreshedSecond)
      .mockResolvedValueOnce(refreshedThird)
      .mockResolvedValueOnce(refreshedFourth);
    const controller = createAdminInboxController(load);
    await controller.refresh();
    await controller.loadMore();
    await controller.refresh();
    const page = controller.snapshot().page!;
    expect(page.total).toBe(26);
    expect(page.items[0].deliveryId).toBe(newArrival.deliveryId);
    expect(page.items.some((item) => item.deliveryId === first.items[11].deliveryId)).toBe(true);
    expect(page.items.some((item) => item.deliveryId === second.items[11].deliveryId)).toBe(true);
    expect(new Set(page.items.map((item) => item.deliveryId)).size).toBe(page.items.length);
    // Page two is still mounted; it was not thrown away by the arrival refresh.
    expect(page.items).toHaveLength(25);
    expect(page.nextCursor).toBe("cursor-after-23");
    // The next page is the one row that has not loaded yet; no duplicate or gap.
    await controller.loadMore();
    const complete = controller.snapshot().page!;
    expect(complete.items).toHaveLength(26);
    expect(new Set(complete.items.map((item) => item.deliveryId)).size).toBe(26);
    expect(complete.nextCursor).toBe(null);
    controller.dispose();
  });

  it("a failed Load more retries the same cursor instead of resetting to page one", async () => {
    const first = fixtureInboxPage({ count: 12, total: 25, nextCursor: "cursor-2" });
    const second = fixtureInboxPage({ count: 12, total: 25, nextCursor: null, offset: 12 });
    const load = vi.fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("Network unavailable."))
      .mockResolvedValueOnce(second);
    const controller = createAdminInboxController(load);
    await controller.refresh();
    await controller.loadMore();
    expect(controller.snapshot().errorAction).toBe("loadMore");
    await controller.loadMore();
    expect(load).toHaveBeenLastCalledWith({ limit: 12, cursor: "cursor-2" });
    expect(controller.snapshot().page?.items).toHaveLength(24);
    controller.dispose();
  });

  it("a second refresh supersedes the first so a late stale page cannot land", async () => {
    let finishFirst!: (value: typeof page) => void;
    let finishSecond!: (value: typeof page) => void;
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
    const controller = createAdminInboxController(load);
    const first = controller.refresh();
    const second = controller.refresh();
    finishSecond({ ...page, total: 30 }); await second;
    finishFirst({ ...page, total: 20 }); await first;
    expect(controller.snapshot().page?.total).toBe(30);
    controller.dispose();
  });
});
