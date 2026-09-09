import assert from "node:assert/strict";
import test from "node:test";
import { planIntentFingerprint } from "../src/lib/work-os-plan-build";

test("AI plan build fingerprints canonicalize whitespace without retaining intent", () => {
  assert.equal(planIntentFingerprint("  Ship\n the   planning gate. "), planIntentFingerprint("Ship the planning gate."));
  assert.match(planIntentFingerprint("Ship the planning gate."), /^[0-9a-f]{64}$/);
  assert.throws(() => planIntentFingerprint("   "), /plan intent is required/);
});
