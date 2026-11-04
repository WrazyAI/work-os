import { afterEach, expect, it, vi } from "vitest";
import { createWorkOsQueryClient, workOsKeys } from "./queryClient";
import { fetchTaskBacklog, updateTaskBacklogCaches } from "./workOsQueries";
vi.mock("./vault", () => ({ secureState: { session: async () => ({ token: "fixture", apiBase: "https://fixture.invalid", organizationId: "org", expiresAt: "2099-01-01" }) } }));
afterEach(() => vi.unstubAllGlobals());

it("loads one backlog page, leaving further work behind an explicit cursor", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    const cursor = new URL(url).searchParams.get("cursor");
    const offset = cursor ? Number(cursor) : 0;
    const tasks = Array.from({ length: Math.min(50, 120 - offset) }, (_, index) => ({ id: String(offset + index), completed: false }));
    return Response.json({ tasks, counts: { total: 120, open: 120, completed: 0 }, nextCursor: offset + tasks.length < 120 ? String(offset + tasks.length) : null });
  });
  const first = await fetchTaskBacklog("2026-11-04");
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("excludeToday=true");
  expect(urls[0]).toContain("date=2026-11-04");
  expect(first.tasks).toHaveLength(50);
  expect(first.counts?.open).toBe(120);
  expect(first.nextCursor).toBe("50");
});

it("keeps loaded page boundaries when an optimistic task enters or leaves", () => {
  const client = createWorkOsQueryClient();
  const key = [...workOsKeys.taskBacklog(), "2026-11-04"];
  client.setQueryData(key, { pages: [
    { tasks: [{ id: "a" }], counts: { total: 2, open: 2, completed: 0 }, nextCursor: "next" },
    { tasks: [{ id: "b" }], counts: { total: 2, open: 2, completed: 0 }, nextCursor: null },
  ], pageParams: [null, "next"] });
  updateTaskBacklogCaches(client, (current) => current ? { ...current, tasks: [{ id: "new" }, ...current.tasks], counts: current.counts ? { ...current.counts, total: 3, open: 3 } : null } : current);
  const pages = client.getQueryData<any>(key).pages;
  expect(pages[0].tasks.map((task: any) => task.id)).toEqual(["new", "a"]);
  expect(pages[1].tasks.map((task: any) => task.id)).toEqual(["b"]);
  expect(pages[1].counts.total).toBe(3);
  updateTaskBacklogCaches(client, (current) => current ? { ...current, tasks: current.tasks.filter((task) => task.id !== "a") } : current);
  expect(client.getQueryData<any>(key).pages.flatMap((page: any) => page.tasks).map((task: any) => task.id)).toEqual(["new", "b"]);
  client.clear();
});
