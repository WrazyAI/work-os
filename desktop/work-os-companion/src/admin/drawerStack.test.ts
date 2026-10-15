import { describe, expect, it, beforeEach } from "vitest";
import { isTopDrawerLayer, pushDrawerLayer, removeDrawerLayer, resetDrawerLayers } from "./drawerStack";

describe("administration drawer layer order", () => {
  beforeEach(() => resetDrawerLayers());

  it("only the last registered drawer is the top layer", () => {
    const person = Symbol("person");
    const update = Symbol("update");
    pushDrawerLayer(person);
    expect(isTopDrawerLayer(person)).toBe(true);
    pushDrawerLayer(update);
    expect(isTopDrawerLayer(update)).toBe(true);
    expect(isTopDrawerLayer(person)).toBe(false);
  });

  it("returns the layer beneath to the top when the top one closes", () => {
    const person = Symbol("person");
    const update = Symbol("update");
    pushDrawerLayer(person);
    pushDrawerLayer(update);
    removeDrawerLayer(update);
    expect(isTopDrawerLayer(person)).toBe(true);
    removeDrawerLayer(person);
    expect(isTopDrawerLayer(person)).toBe(false);
  });

  it("tolerates removals out of order and double removals", () => {
    const first = Symbol("first");
    const second = Symbol("second");
    pushDrawerLayer(first);
    pushDrawerLayer(second);
    // The bottom drawer unmounts first (a section navigation while a detail
    // drawer sits above it), then the top one goes.
    removeDrawerLayer(first);
    removeDrawerLayer(first);
    expect(isTopDrawerLayer(second)).toBe(true);
    removeDrawerLayer(second);
    expect(isTopDrawerLayer(second)).toBe(false);
  });

  it("stays stable across rapid open/close cycles", () => {
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const token = Symbol(`cycle-${cycle}`);
      pushDrawerLayer(token);
      expect(isTopDrawerLayer(token)).toBe(true);
      removeDrawerLayer(token);
      expect(isTopDrawerLayer(token)).toBe(false);
    }
  });
});
