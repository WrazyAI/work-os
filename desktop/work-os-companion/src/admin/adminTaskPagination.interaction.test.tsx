// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationProvider } from "../NotificationFlyouts";
import { adminKeys } from "./data";
import TasksPage from "./TasksPage";

vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  apiRequest: vi.fn(),
}));

import { apiRequest } from "../api";

afterEach(() => vi.unstubAllGlobals());

it("requests successive offsets and retries a failed continuation without dropping loaded rows", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const offsets: number[] = [];
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    const params = new URL(path, "https://fixture.invalid").searchParams;
    expect(params.get("limit")).toBe("100");
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    if (offsets.length === 2) throw new Error("Temporary failure");
    const count = offset === 0 ? 100 : offset === 100 ? 100 : 45;
    return {
      tasks: Array.from({ length: count }, (_, i) => ({ id: String(offset + i + 1), title: `Fixture task ${offset + i + 1}` })),
      nextOffset: count === 100 ? offset + count : null,
      summary: { open: 245, overdue: 12, completedWeek: 7 },
    };
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(adminKeys.people(), { people: [] });
  client.setQueryData(adminKeys.projects(), { projects: [] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rows = () => host.querySelectorAll("tr[data-pan-row]").length;
  const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  async function settleUntil(done: () => boolean) {
    const deadline = Date.now() + 2000;
    while (!done() && Date.now() < deadline) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    expect(done()).toBe(true);
  }
  async function waitForRows(expected: number) {
    await settleUntil(() => rows() === expected);
    expect(rows()).toBe(expected);
  }
  async function click(label: string) {
    const target = button(label);
    expect(target).toBeDefined();
    await act(async () => { target!.click(); });
  }
  try {
    await act(async () => {
      root.render(<QueryClientProvider client={client}><NotificationProvider><TasksPage /></NotificationProvider></QueryClientProvider>);
    });
    await waitForRows(100);
    await click("Show more");
    await settleUntil(() => !!button("Retry"));
    expect(rows()).toBe(100);
    expect(host.textContent).toContain("245 open · 12 overdue · 7 completed in the last 7 days");
    await click("Retry");
    await waitForRows(200);
    await click("Show more");
    await waitForRows(245);
    expect(offsets).toEqual([0, 100, 100, 200]);
    expect(host.querySelector('[aria-label="Open task Fixture task 1"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Open task Fixture task 245"]')).not.toBeNull();
    expect(button("Show more")).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
  }
});
