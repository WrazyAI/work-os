import { describe, expect, it } from "vitest";
import { deriveMascotVisualState } from "./mascotState";

describe("deriveMascotVisualState", () => {
  it("lets agent lifecycle own the primary expression", () => {
    expect(deriveMascotVisualState({ agent: "working", workday: "active" }).pose).toBe("think");
    expect(deriveMascotVisualState({ agent: "needs-input", workday: "active" }).pose).toBe("alert");
    expect(deriveMascotVisualState({ agent: "ready", workday: "active" }).pose).toBe("celebrate");
    expect(deriveMascotVisualState({ agent: "blocked", workday: "active" }).pose).toBe("recover");
  });

  it("uses workday state only when the agent is idle", () => {
    expect(deriveMascotVisualState({ agent: "idle", workday: "off-shift" })).toMatchObject({ pose: "sleep", label: "Resting" });
    expect(deriveMascotVisualState({ agent: "idle", workday: "paused" })).toMatchObject({ pose: "rest", label: "Paused" });
    expect(deriveMascotVisualState({ agent: "idle", workday: "check-in-due" })).toMatchObject({ pose: "alert", attention: true });
  });

  it("keeps late-start as a secondary tone even while the agent is working", () => {
    expect(deriveMascotVisualState({ agent: "working", workday: "late" })).toMatchObject({
      pose: "think",
      tone: "late",
      label: "Working",
    });
  });

  it("marks ready as a transient celebration state", () => {
    expect(deriveMascotVisualState({ agent: "ready", workday: "active" })).toMatchObject({
      transient: true,
      attention: false,
    });
  });
});
