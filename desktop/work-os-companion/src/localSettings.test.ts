import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CADENCE_HEADER,
  FIRST_FOLLOW_UP_HEADER,
  parseMachineCadence,
} from "./localSettings";

describe("the machine's own config file", () => {
  it("reads the cadence an employee set", () => {
    expect(parseMachineCadence('{"checkInIntervalMinutes":30,"firstFollowUpMinutes":10}'))
      .toEqual({ checkInIntervalMinutes: 30, firstFollowUpMinutes: 10 });
    // One value is enough; the other stays with the workspace.
    expect(parseMachineCadence('{"checkInIntervalMinutes":45}')).toEqual({ checkInIntervalMinutes: 45 });
  });

  it("ignores anything outside the shared bounds", () => {
    // Bounds match the deployment, so a hand edit cannot storm or silence a day.
    expect(parseMachineCadence('{"checkInIntervalMinutes":241}')).toBeNull();
    expect(parseMachineCadence('{"checkInIntervalMinutes":4}')).toBeNull();
    expect(parseMachineCadence('{"checkInIntervalMinutes":"soon"}')).toBeNull();
    expect(parseMachineCadence('{"checkInIntervalMinutes":60.5}')).toBeNull();
    // A partially valid file keeps only the valid field.
    expect(parseMachineCadence('{"checkInIntervalMinutes":300,"firstFollowUpMinutes":30}'))
      .toEqual({ firstFollowUpMinutes: 30 });
  });

  it("treats a broken or empty file as no override at all", () => {
    for (const text of ["", "not json", "[]", "null", "{}", '{"somethingElse":1}']) {
      expect(parseMachineCadence(text)).toBeNull();
    }
  });

  it("reports the cadence on requests only when the file named one", () => {
    const source = readFileSync(resolve(import.meta.dirname, "localSettings.ts"), "utf8");
    expect(source).toContain(`"x-work-os-cadence-minutes"`);
    expect(source).toContain(`"x-work-os-first-follow-up-minutes"`);
    expect(CADENCE_HEADER).toBe("x-work-os-cadence-minutes");
    expect(FIRST_FOLLOW_UP_HEADER).toBe("x-work-os-first-follow-up-minutes");
    // Headers come from the parsed value, never from the raw file text.
    expect(source).toContain("export function machineCadenceHeaders()");
    expect(source).toContain("if (!current) return {};");
  });
});

describe("local config wiring", () => {
  const read = (name: string) => readFileSync(resolve(import.meta.dirname, name), "utf8");

  it("attaches the machine cadence to every API request", () => {
    const api = read("api.ts");
    expect(api).toContain('import { machineCadenceHeaders } from "./localSettings"');
    const headerBlock = api.indexOf('"X-Work-OS-Organization-Id": session.organizationId,');
    expect(headerBlock).toBeGreaterThan(-1);
    expect(api.slice(headerBlock, headerBlock + 200)).toContain("...machineCadenceHeaders()");
  });

  it("creates the file from the workspace cadence, then keeps the local edit", () => {
    const app = read("App.tsx");
    expect(app).toContain("loadMachineCadence(");
    // Seeded from the day payload's cadence, so a fresh install starts from policy.
    expect(app).toContain("visibleDay?.cadence");
    expect(app).toContain("workspaceCadence.checkInIntervalMinutes");
    // The host never overwrites an existing file.
    const rust = readFileSync(resolve(import.meta.dirname, "../src-tauri/src/local_settings.rs"), "utf8");
    expect(rust).toContain("ensure_local_settings");
    expect(rust).toContain("if let Ok(existing) = std::fs::read_to_string(&path)");
    expect(rust).toContain("work-os.local.json");
  });
});
