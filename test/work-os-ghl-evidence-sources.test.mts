import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE_SOURCE_OPTIONS, evidenceSourceLabel } from "../src/modules/work-os/evidence-sources";

test("GoHighLevel is a first-class enabled evidence source", () => {
  const ghl = EVIDENCE_SOURCE_OPTIONS.find((option) => option.value === "ghl");
  assert.ok(ghl, "the Evidence page must offer a GoHighLevel filter");
  assert.equal(ghl.label, "GoHighLevel");
  assert.equal("disabled" in ghl, false);
  assert.equal(EVIDENCE_SOURCE_OPTIONS.filter((option) => option.value === "ghl").length, 1);
});

test("the source label is consistent in the summary, row, and detail", () => {
  assert.equal(evidenceSourceLabel("ghl"), "GoHighLevel");
  assert.equal(evidenceSourceLabel("worktivity"), "Worktivity (activity)");
  assert.equal(evidenceSourceLabel("github"), "GitHub");
  assert.equal(evidenceSourceLabel("manual"), "Manual");
  assert.equal(evidenceSourceLabel("nifty"), "Legacy import");
  assert.equal(evidenceSourceLabel(""), "Unknown source");
});
