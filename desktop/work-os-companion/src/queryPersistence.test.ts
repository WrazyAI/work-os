import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { clearWorkOsAccountCache, createWorkOsQueryClient, startWorkOsQueryPersistence } from "./queryClient";
import { secureState } from "./vault";

vi.mock("./vault", () => ({ secureState: { saveQueryCache: vi.fn(async () => undefined), clearAccount: vi.fn(async () => undefined) } }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("employee cache persistence", () => {
  it("waits for an in-flight save before clearing an account and drops queued old data", async () => {
    vi.useFakeTimers();
    const client = createWorkOsQueryClient();
    let release!: () => void;
    vi.mocked(secureState.saveQueryCache).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const stop = startWorkOsQueryPersistence(client);
    client.setQueryData(["work-os", "day", "compact"], { person: "old" });
    await vi.advanceTimersByTimeAsync(2_501);
    client.setQueryData(["work-os", "day", "compact"], { person: "old", late: true });
    const clearing = clearWorkOsAccountCache(client);
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.clearAccount).not.toHaveBeenCalled();
    release(); await clearing;
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.clearAccount).toHaveBeenCalledTimes(1);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    client.setQueryData(["work-os", "day", "compact"], { person: "new" });
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(2);
    stop(); client.clear();
  });
  it("does not save observer-only or excluded admin changes", async () => {
    vi.useFakeTimers();
    const client = createWorkOsQueryClient();
    client.setQueryData(["work-os", "day", "compact"], { value: 1 });
    const stop = startWorkOsQueryPersistence(client);
    const observer = new QueryObserver(client, { queryKey: ["work-os", "day", "compact"], enabled: false });
    const off = observer.subscribe(() => undefined);
    for (let index = 0; index < 5; index++) {
      observer.setOptions({ queryKey: ["work-os", "day", "compact"], enabled: false, staleTime: index });
      await vi.advanceTimersByTimeAsync(2_501);
    }
    client.setQueryData(["work-os", "admin", "overview"], { rows: [1] });
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(0);
    client.setQueryData(["work-os", "day", "compact"], { value: 2 });
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(1);
    client.setQueryData(["work-os", "day", "compact"], { value: 2 });
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(1);
    off(); stop(); client.clear();
  });

  it("retries a changed cache after a failed vault write instead of dropping it", async () => {
    vi.useFakeTimers();
    const client = createWorkOsQueryClient();
    vi.mocked(secureState.saveQueryCache).mockRejectedValueOnce(new Error("vault busy")).mockResolvedValueOnce(undefined);
    const stop = startWorkOsQueryPersistence(client);
    client.setQueryData(["work-os", "day", "compact"], { value: 7 });
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_001);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(2);
    stop(); client.clear();
  });

  it("coalesces changes during a slow save without overlapping writes", async () => {
    vi.useFakeTimers();
    const client = createWorkOsQueryClient();
    let release!: () => void;
    vi.mocked(secureState.saveQueryCache).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const stop = startWorkOsQueryPersistence(client);
    client.setQueryData(["work-os", "day", "compact"], { value: 1 });
    await vi.advanceTimersByTimeAsync(2_501);
    client.setQueryData(["work-os", "day", "compact"], { value: 2 });
    await vi.advanceTimersByTimeAsync(2_501);
    client.setQueryData(["work-os", "day", "compact"], { value: 3 });
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(2_501);
    expect(secureState.saveQueryCache).toHaveBeenCalledTimes(2);
    const saved = JSON.parse(vi.mocked(secureState.saveQueryCache).mock.calls[1]![0]);
    expect(saved.queries[0].state.data).toEqual({ value: 3 });
    stop(); client.clear();
  });
});
