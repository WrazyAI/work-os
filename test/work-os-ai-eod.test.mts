import assert from "node:assert/strict";
import test from "node:test";
import { buildEodPrompt, ensureBottleneckSection, parseEodSelection, renderEodSelection } from "../src/lib/aiEod";

test("the prompt grounds the model in only the recorded facts", () => {
  const prompt = buildEodPrompt({
    date: "2026-08-27", personName: "David", clockedInAt: "2026-08-27T15:00:00Z", clockedOutAt: null,
    updates: [{ kind: "material_progress", text: "Finished the debugger fix.", at: "2026-08-27T16:00:00Z" }],
    completed: ["Ship the debugger fix"], carried: [], blockers: ["Signing certificate"],
  });
  assert.match(prompt, /Finished the debugger fix\./);
  assert.match(prompt, /Ship the debugger fix/);
  assert.match(prompt, /Signing certificate/);
  assert.match(prompt, /Bottleneck/);
  assert.match(prompt, /never invent/i);
});

test("keeps a valid bottleneck section untouched", () => {
  const markdown = "## Summary\nA calm day.\n## Bottleneck\nThe certificate is still pending.";
  assert.equal(ensureBottleneckSection(markdown), markdown.replace(/\s+$/, ""));
});

test("appends an explicit placeholder when the model omitted the bottleneck", () => {
  const markdown = ensureBottleneckSection("## Summary\nA calm day.\n## Completed\n- Nothing.");
  assert.match(markdown ?? "", /## Bottleneck/);
  assert.match(markdown ?? "", /needs your input/);
});

test("rejects non-string or empty narratives", () => {
  assert.equal(ensureBottleneckSection(null), null);
  assert.equal(ensureBottleneckSection("   "), null);
});

test("accepts only record-bound EOD fact ids and renders the original facts", () => {
  const grounding = {
    date: "2026-08-27", personName: "David", clockedInAt: null, clockedOutAt: null,
    updates: [{ kind: "material_progress", text: "Finished the debugger fix.", at: "2026-08-27T16:00:00Z" }],
    completed: ["Ship the debugger fix"], carried: ["Package the installer"], blockers: ["Signing certificate"],
  };
  const selection = parseEodSelection({ summaryFactIds: ["update:0"], completedFactIds: ["completed:0"], carriedFactIds: ["carried:0"], blockerFactIds: ["blocker:0", "foreign:7"] }, grounding);
  assert.deepEqual(selection, { summaryFactIds: ["update:0"], completedFactIds: ["completed:0"], carriedFactIds: ["carried:0"], blockerFactIds: ["blocker:0"] });
  const markdown = renderEodSelection(selection!, grounding);
  assert.match(markdown, /Finished the debugger fix/);
  assert.match(markdown, /Ship the debugger fix/);
  assert.doesNotMatch(markdown, /foreign/);
});

test("rejects malformed EOD selections rather than trusting model prose", () => {
  const grounding = { date: "2026-08-27", personName: "David", clockedInAt: null, clockedOutAt: null, updates: [], completed: [], carried: [], blockers: [] };
  assert.equal(parseEodSelection("invented narrative", grounding), null);
  assert.equal(parseEodSelection({ summaryFactIds: "update:0" }, grounding), null);
});
