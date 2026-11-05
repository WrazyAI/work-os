import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryObserver, environmentManager, focusManager } from "@tanstack/react-query";
import { readinessAttention } from "../../../../src/modules/work-os/admin-readiness";
import * as data from "./data";
import { workOsQueryClient } from "../queryClient";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ apiRequest: request }));

afterEach(() => {
  workOsQueryClient.clear();
  focusManager.setFocused(undefined);
  environmentManager.setIsServer(() => true);
  vi.useRealTimers();
  request.mockReset();
});

describe("separate Overview setup lifecycle", () => {
  it("does not reload readiness on minute snapshots and does refresh it after confirmed setup/task writes", async () => {
    // This checks our real options and mutation fetchers, not a handwritten
    // imitation of the page's query settings.
    environmentManager.setIsServer(() => false);
    vi.useFakeTimers();
    focusManager.setFocused(true);
    request.mockImplementation(async (path: string) => path.includes("readiness") ? { status: "blocked", issues: [] } : {});
    const observer = new QueryObserver(workOsQueryClient, data.adminReadinessQueryOptions());
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.filter(([path]) => path === "/api/work-os/readiness")).toHaveLength(1);
    for (let minute = 0; minute < 3; minute++) {
      await data.fetchAdminOverview();
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(request.mock.calls.filter(([path]) => path === "/api/work-os/readiness")).toHaveLength(1);
    for (const mutate of [
      () => data.saveOrganizationFeatures({ employee_companion: true }),
      () => data.updateAdminPerson({ id: "p", role_profile_id: "r" }),
      () => data.organizationAction({ action: "create_team", name: "Team" }),
      () => data.organizationMembershipPatch({ id: "m", active: false }),
      () => data.mapGithubActor({ workspace: "w", externalAccountId: "a", personId: "p", login: "p" }),
      () => data.updateAdminTask("t", { priority: "high" }),
      () => data.createAdminTask({ title: "New" }),
      () => data.completeAdminTask("t", true),
      () => data.deleteAdminTask("t", "archive"),
    ]) {
      const before = request.mock.calls.filter(([path]) => path === "/api/work-os/readiness").length;
      await mutate();
      await vi.advanceTimersByTimeAsync(0);
      expect(request.mock.calls.filter(([path]) => path === "/api/work-os/readiness")).toHaveLength(before + 1);
    }
    const beforeFailure = request.mock.calls.filter(([path]) => path === "/api/work-os/readiness").length;
    request.mockRejectedValueOnce(new Error("write failed"));
    await expect(data.saveOrganizationFeatures({})).rejects.toThrow("write failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.filter(([path]) => path === "/api/work-os/readiness")).toHaveLength(beforeFailure);
    unsubscribe();
    const beforeInactive = request.mock.calls.filter(([path]) => path === "/api/work-os/readiness").length;
    await data.saveOrganizationFeatures({});
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.filter(([path]) => path === "/api/work-os/readiness")).toHaveLength(beforeInactive);
    const next = new QueryObserver(workOsQueryClient, data.adminReadinessQueryOptions());
    const stop = next.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.filter(([path]) => path === "/api/work-os/readiness")).toHaveLength(beforeInactive + 1);
    // The masthead's Overview-prefix refresh must include the separate setup
    // query. Its regular minute fetch never invalidates this prefix.
    await workOsQueryClient.invalidateQueries({ queryKey: ["work-os", "admin", "overview"] });
    expect(request.mock.calls.filter(([path]) => path === "/api/work-os/readiness")).toHaveLength(beforeInactive + 2);
    stop();
  });

  it("revalidates stale setup on remount and removes resolved configuration blockers", async () => {
    environmentManager.setIsServer(() => false);
    vi.useFakeTimers();
    request.mockResolvedValue({ issues: [{ severity: "blocked", count: 2 }] });
    const first = new QueryObserver(workOsQueryClient, data.adminReadinessQueryOptions());
    const stop = first.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(readinessAttention(first.getCurrentResult().data)[0]?.count).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    request.mockResolvedValue({ issues: [] });
    const second = new QueryObserver(workOsQueryClient, data.adminReadinessQueryOptions());
    const stopAgain = second.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(readinessAttention(second.getCurrentResult().data)).toEqual([]);
    stopAgain();
  });
});
