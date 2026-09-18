import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOT_PHASE_KEY, CLEAN_EXIT, createBootTrace, type BootStorage } from "./bootTrace";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } satisfies BootStorage & { values: Map<string, string> };
}

describe("boot trace", () => {
  it("reports a previous run that never exited cleanly", () => {
    const unclean: string[] = [];
    const storage = memoryStorage({ [BOOT_PHASE_KEY]: "boot:workspace_ready" });
    createBootTrace(storage, (previous) => unclean.push(previous)).begin();
    expect(unclean).toEqual(["boot:workspace_ready"]);
    expect(storage.getItem(BOOT_PHASE_KEY)).toBe("boot:webview");
  });

  it("stays quiet after a clean exit", () => {
    const unclean: string[] = [];
    const storage = memoryStorage({ [BOOT_PHASE_KEY]: CLEAN_EXIT });
    createBootTrace(storage, (previous) => unclean.push(previous)).begin();
    expect(unclean).toEqual([]);
  });

  it("stays quiet on the very first launch", () => {
    const unclean: string[] = [];
    createBootTrace(memoryStorage(), (previous) => unclean.push(previous)).begin();
    expect(unclean).toEqual([]);
  });

  it("records each phase and a clean exit", () => {
    const phases: string[] = [];
    const storage = memoryStorage();
    const trace = createBootTrace(storage, () => undefined, (phase) => phases.push(phase));
    trace.begin();
    trace.phase("boot:workspace_ready");
    expect(storage.getItem(BOOT_PHASE_KEY)).toBe("boot:workspace_ready");
    expect(phases).toEqual(["boot:workspace_ready"]);
    trace.cleanExit();
    expect(storage.getItem(BOOT_PHASE_KEY)).toBe(CLEAN_EXIT);
  });

  it("never throws when storage is unavailable", () => {
    const storage: BootStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    const trace = createBootTrace(storage, () => { throw new Error("should not be called"); });
    expect(() => trace.begin()).not.toThrow();
    expect(() => trace.phase("boot:webview")).not.toThrow();
    expect(() => trace.cleanExit()).not.toThrow();
  });
});

describe("boot trace wiring", () => {
  const read = (name: string) => readFileSync(resolve(import.meta.dirname, name), "utf8");

  it("is installed from the entrypoint before the app renders", () => {
    const main = read("main.tsx");
    const install = main.indexOf("installBootTrace()");
    const render = main.indexOf("ReactDOM.createRoot");
    expect(install).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(install);
  });

  it("records the boot phase at every gate", () => {
    const app = read("App.tsx");
    for (const phase of ["boot:loading", "boot:connect_screen", "boot:waiting_for_data", "boot:onboarding", "boot:workspace_ready"]) {
      expect(app).toContain(phase);
    }
    expect(app).toContain("markBootPhase(bootPhase)");
  });

  it("marks an update install as an intentional exit, not a crash", () => {
    const app = read("App.tsx");
    const mark = app.indexOf("markCleanExit()");
    const install = app.indexOf("await flow.update.install()");
    expect(mark).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(mark);
  });
});
