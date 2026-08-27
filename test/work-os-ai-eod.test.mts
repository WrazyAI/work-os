import assert from "node:assert/strict";
import test from "node:test";
import { buildEodPrompt, ensureBottleneckSection } from "../src/lib/aiEod";

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
