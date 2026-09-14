import assert from "node:assert/strict";
import test from "node:test";
import { dailyGoalDisplay } from "../src/lib/work-os-daily-workspace";

test("the AI draft is the displayed goal and the typed intent stays exposed", () => {
  const displayed = dailyGoalDisplay({
    focus_summary: "Improve Work OS cash management and migrate to macOS.",
    freeform_intent: "improve cash mgmt and migrate to mac",
    goal_provenance: "ai_draft",
  });
  assert.equal(displayed.text, "Improve Work OS cash management and migrate to macOS.");
  assert.equal(displayed.intent, "improve cash mgmt and migrate to mac");
  assert.equal(displayed.provenance, "ai_draft");
});

test("without a draft the raw intent is the displayed goal", () => {
  const displayed = dailyGoalDisplay({ freeform_intent: "Ship the release.", goal_provenance: "employee" });
  assert.equal(displayed.text, "Ship the release.");
  assert.equal(displayed.intent, "Ship the release.");
  assert.equal(displayed.provenance, "employee");
});

test("blank drafts and whitespace fall back to the intent", () => {
  assert.equal(dailyGoalDisplay({ focus_summary: "   ", freeform_intent: "Real note." }).text, "Real note.");
  assert.equal(dailyGoalDisplay({ focus_summary: null, freeform_intent: null }).text, null);
  assert.equal(dailyGoalDisplay({ freeform_intent: "Typed it." }).provenance, "employee");
  assert.equal(dailyGoalDisplay(null).text, null);
  assert.equal(dailyGoalDisplay(null).provenance, null);
});
