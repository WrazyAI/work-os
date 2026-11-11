import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_OTTO_INTENT_ACTIONS, requireAdminOttoIntent } from "../src/lib/work-os-admin-otto-intent";

test("GHL is an explicit typed admin read, not a mutation", () => {
  assert.ok(ADMIN_OTTO_INTENT_ACTIONS.includes("ghl"));
  const intent = requireAdminOttoIntent({
    action: "ghl",
    target: { kind: "names", names: ["Aden Badon"], ids: null },
    date: null,
    from: null,
    through: null,
    relativeDay: null,
    overdueOnly: false,
    latest: false,
  });
  assert.equal(intent.action, "ghl");
  assert.equal(intent.target.kind, "names");
});

test("an unknown admin action is rejected", () => {
  assert.throws(() => requireAdminOttoIntent({
    action: "send_message",
    target: { kind: "team", names: null, ids: null },
    date: null,
    from: null,
    through: null,
    relativeDay: null,
    overdueOnly: false,
    latest: false,
  }));
});
