import assert from "node:assert/strict";
import test from "node:test";
import { buildEodPrompt, parseEodSelection, renderCommitmentReconciliation, renderEodSelection } from "../src/lib/aiEod";

test("the prompt grounds the model in only the recorded facts", () => {
  const prompt = buildEodPrompt({
    date: "2026-08-27", personName: "David", clockedInAt: "2026-08-27T15:00:00Z", clockedOutAt: null,
    updates: [{ kind: "material_progress", text: "Finished the debugger fix.", at: "2026-08-27T16:00:00Z" }],
    completed: ["Ship the debugger fix"], carried: [], blockers: ["Signing certificate"], commitments: [{ title: "Ship the debugger fix", status: "selected" }],
  });
  assert.match(prompt, /Finished the debugger fix\./);
  assert.match(prompt, /Ship the debugger fix/);
  assert.match(prompt, /Signing certificate/);
  assert.match(prompt, /Bottleneck/);
  assert.match(prompt, /planning status only/i);
  assert.match(prompt, /never invent/i);
});

test("reconciles persisted daily commitments without treating them as task evidence", () => {
  assert.deepEqual(renderCommitmentReconciliation([{ title: "Ship the release", status: "completed" }, { title: "Review the migration", status: "deferred" }]), [
    "- Ship the release (marked complete in the plan)",
    "- Review the migration (deferred in the plan)",
  ]);
});

test("renders the Bottleneck section only when blockers were recorded", () => {
  const grounding = { date: "2026-08-27", personName: "David", clockedInAt: null, clockedOutAt: null, updates: [], completed: [], carried: [], blockers: ["Signing certificate"] };
  const selection = { summaryFactIds: [], completedFactIds: [], carriedFactIds: [], blockerFactIds: ["blocker:0"], observedFactIds: [], mediaFactIds: [] };
  const withBlocker = renderEodSelection(selection, grounding);
  assert.match(withBlocker, /## Bottleneck/);
  assert.match(withBlocker, /- Signing certificate/);
  const withoutBlocker = renderEodSelection({ ...selection, blockerFactIds: [] }, { ...grounding, blockers: [] });
  assert.doesNotMatch(withoutBlocker, /## Bottleneck/);
  assert.doesNotMatch(withoutBlocker, /needs your input/);
});

test("accepts only record-bound EOD fact ids and renders the original facts", () => {
  const grounding = {
    date: "2026-08-27", personName: "David", clockedInAt: null, clockedOutAt: null,
    updates: [{ kind: "material_progress", text: "Finished the debugger fix.", at: "2026-08-27T16:00:00Z" }],
    completed: ["Ship the debugger fix"], carried: ["Package the installer"], blockers: ["Signing certificate"],
  };
  const selection = parseEodSelection({ summaryFactIds: ["update:0"], completedFactIds: ["completed:0"], carriedFactIds: ["carried:0"], blockerFactIds: ["blocker:0", "foreign:7"], observedFactIds: [], mediaFactIds: [] }, grounding);
  assert.deepEqual(selection, { summaryFactIds: ["update:0"], completedFactIds: ["completed:0"], carriedFactIds: ["carried:0"], blockerFactIds: ["blocker:0"], observedFactIds: [], mediaFactIds: [] });
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
