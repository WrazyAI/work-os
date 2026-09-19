import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTANCE_HEARTBEAT_MS, startInstanceHeartbeat } from "./instanceHeartbeat";

describe("instance heartbeat", () => {
  it("beats immediately, then on the cadence", () => {
    const beats: number[] = [];
    let scheduled: (() => void) | null = null;
    let interval = 0;
    const stop = startInstanceHeartbeat(() => beats.push(beats.length), {
      schedule: (handler, ms) => { scheduled = handler; interval = ms; return 7; },
      cancel: () => undefined,
    });
    expect(beats).toHaveLength(1);
    expect(interval).toBe(INSTANCE_HEARTBEAT_MS);
    scheduled!();
    expect(beats).toHaveLength(2);
    stop();
  });

  it("stops beating when told to", () => {
    const beats: number[] = [];
    let cancelled = -1;
    const stop = startInstanceHeartbeat(() => beats.push(1), {
      schedule: () => 42,
      cancel: (id) => { cancelled = id; },
    });
    stop();
    expect(cancelled).toBe(42);
    expect(beats).toHaveLength(1);
  });

  it("is wired to the main window, which is the window the host records", () => {
    // The ACL guard attributes an invoke to the window that can reach it, so the
    // beat must come from App.tsx (the main window) and be Tauri-only.
    const app = readFileSync(resolve(import.meta.dirname, "App.tsx"), "utf8");
    expect(app).toContain('invoke("app_heartbeat")');
    expect(app).toContain("startInstanceHeartbeat");
    const index = app.indexOf('invoke("app_heartbeat")');
    expect(app.slice(Math.max(0, index - 400), index)).toContain("isTauri()");
  });
});
