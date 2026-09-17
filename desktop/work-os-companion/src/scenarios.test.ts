import { describe, expect, it } from "vitest";
import { DEBUG_PRESETS, DEFAULT_DEBUG_SCENARIO, activePresetId, presetScenarioMatches } from "./scenarios";

function loaded(presetId: string) {
  const preset = DEBUG_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`Unknown preset ${presetId}`);
  return { ...DEFAULT_DEBUG_SCENARIO, ...preset.scenario };
}

describe("active preset marker", () => {
  it("marks the preset a scenario was loaded from", () => {
    for (const preset of DEBUG_PRESETS) {
      expect(activePresetId(loaded(preset.id))).toBe(preset.id);
    }
  });

  it("marks nothing while scenarios are off", () => {
    expect(activePresetId(DEFAULT_DEBUG_SCENARIO)).toBeNull();
    expect(activePresetId({ ...loaded("offline_playground"), enabled: false })).toBeNull();
  });

  it("drops the marker once any override is touched", () => {
    const scenario = loaded("eod");
    expect(activePresetId(scenario)).toBe("eod");
    expect(activePresetId({ ...scenario, queuedUpdates: 2 })).toBeNull();
    expect(activePresetId({ ...scenario, niftyFailure: true })).toBeNull();
    expect(activePresetId({ ...scenario, liveWrites: true })).toBeNull();
    expect(activePresetId({ ...scenario, companionForce: "quiet" })).toBeNull();
  });

  it("ignores the order of the missing-detail keys", () => {
    const scenario = loaded("first_launch");
    expect(activePresetId({ ...scenario, missingDetails: [...scenario.missingDetails].reverse() })).toBe("first_launch");
  });

  it("keeps a hand-built scenario unmarked", () => {
    expect(activePresetId({ ...DEFAULT_DEBUG_SCENARIO, enabled: true })).toBeNull();
    expect(activePresetId({ ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: true })).toBeNull();
  });

  it("matches a preset's own scenario through the shared helper", () => {
    expect(presetScenarioMatches(DEBUG_PRESETS[0], loaded(DEBUG_PRESETS[0].id))).toBe(true);
    expect(presetScenarioMatches(DEBUG_PRESETS[0], loaded(DEBUG_PRESETS[1].id))).toBe(false);
  });
});
