import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMascotAttireController, nextAttireTransition } from "./mascotAttire";

describe("mascot attire", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("derives dress, undress and no-op directions", () => {
    expect(nextAttireTransition("employee", "admin")).toBe("on");
    expect(nextAttireTransition("admin", "employee")).toBe("off");
    expect(nextAttireTransition("employee", "employee")).toBeNull();
    expect(nextAttireTransition("admin", "admin")).toBeNull();
  });

  it("initial_mount_has_no_transition", () => {
    for (const mode of ["employee", "admin"] as const) {
      const controller = createMascotAttireController(mode, () => undefined);
      controller.update(mode, true, false);
      expect(controller.transition()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      controller.dispose();
    }
  });

  it("same_mode_rerender_does_not_replay", () => {
    const changes: unknown[] = [];
    const controller = createMascotAttireController("employee", (value) => changes.push(value));
    controller.update("admin", true, false);
    expect(controller.transition()).toBe("on");
    vi.advanceTimersByTime(250);
    controller.update("admin", true, false);
    // The original deadline must win; a same-mode render cannot extend it.
    vi.advanceTimersByTime(150);
    expect(controller.transition()).toBeNull();
    controller.update("admin", true, false);
    expect(changes).toEqual(["on", null]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rapid_reverse_cancels_previous_timer", () => {
    const changes: unknown[] = [];
    const controller = createMascotAttireController("employee", (value) => changes.push(value));
    controller.update("admin", true, false);
    vi.advanceTimersByTime(200);
    controller.update("employee", true, false);
    expect(controller.transition()).toBe("off");
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(300);
    expect(controller.transition()).toBe("off");
    vi.advanceTimersByTime(400);
    expect(changes).toEqual(["on", "off", null]);
  });

  it("disabled_or_reduced_motion_parks_final_state", () => {
    for (const [enabled, reduced] of [[false, false], [true, true]] as const) {
      const controller = createMascotAttireController("employee", () => undefined);
      controller.update("admin", enabled, reduced);
      expect(controller.transition()).toBeNull();
      controller.update("admin", true, false);
      expect(controller.transition()).toBeNull();
      controller.update("employee", true, false);
      expect(controller.transition()).toBe("off");
      controller.update("employee", enabled, reduced);
      expect(controller.transition()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      controller.dispose();
    }
  });

  it("toggling animation back on does not replay a finished or disabled flourish", () => {
    const controller = createMascotAttireController("employee", () => undefined);
    controller.update("admin", true, false);
    vi.advanceTimersByTime(400);
    expect(controller.transition()).toBeNull();
    controller.update("admin", false, false);
    controller.update("admin", true, false);
    expect(controller.transition()).toBeNull();
    controller.dispose();
  });

  it("unmount_clears_timer", () => {
    const changes: unknown[] = [];
    const controller = createMascotAttireController("employee", (value) => changes.push(value));
    controller.update("admin", true, false);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    controller.update("employee", true, false);
    expect(changes).toEqual(["on"]);
  });
});
