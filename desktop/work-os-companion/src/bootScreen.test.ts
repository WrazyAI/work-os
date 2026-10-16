import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { bootRiseClass, BOOT_STAGE_COPY, resolveBootScreen } from "./bootScreen";

const base = { vault: "opened", hasSession: true, adminReady: false, onboarding: { onboardingRequired: false }, dayReady: false, dayFailed: false } as const;

describe("boot screen resolver", () => {
  // Resolution order is today's gate chain + the §4.1 hold:
  it("resolves the boot surface following the gate chain with the real-content hold", () => {
    assert.deepEqual(resolveBootScreen({ ...base, vault: "pending" }), { kind: "loading", phase: "vault" });
    assert.deepEqual(resolveBootScreen({ ...base, vault: "failed" }), { kind: "failed" });
    assert.deepEqual(resolveBootScreen({ ...base, hasSession: false }), { kind: "content", surface: "connect" });
    assert.deepEqual(resolveBootScreen({ ...base, onboarding: null }), { kind: "loading", phase: "day" });
    assert.deepEqual(resolveBootScreen({ ...base, onboarding: { onboardingRequired: true } }), { kind: "content", surface: "onboarding" });
    assert.deepEqual(resolveBootScreen({ ...base, adminReady: true }), { kind: "content", surface: "admin" });
    // The hold: real content (§4.1) — no day yet, no failure → stay on First Light.
    assert.deepEqual(resolveBootScreen(base), { kind: "loading", phase: "day" });
    assert.deepEqual(resolveBootScreen({ ...base, dayReady: true }), { kind: "content", surface: "workspace" });
    assert.deepEqual(resolveBootScreen({ ...base, dayFailed: true }), { kind: "content", surface: "workspace" });
  });

  // Stage copy is exact, apostrophe included.
  it("carries the exact stage copy", () => {
    assert.equal(BOOT_STAGE_COPY.vault, "Opening this device’s saved session");
    assert.equal(BOOT_STAGE_COPY.day, "Reading your schedule and workday");
  });

  // bootRiseClass: only a loading→content handoff rises.
  it("rises only through a loading-to-content handoff", () => {
    assert.equal(bootRiseClass("loading", "content"), "workspace boot-rise");
    assert.equal(bootRiseClass(null, "content"), "workspace");
    assert.equal(bootRiseClass("content", "content"), "workspace");
    assert.equal(bootRiseClass(null, "loading"), "workspace");
    assert.equal(bootRiseClass("failed", "content"), "workspace");
  });
});
