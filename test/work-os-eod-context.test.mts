import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEodPrompt, parseEodSelection, renderEodSelection, type EodGrounding } from "../src/lib/aiEod";
import { eodLineItems } from "../src/lib/work-os-eod";

const grounding: EodGrounding = {
  date: "2026-09-15",
  personName: "Preview Employee",
  clockedInAt: "2026-09-15T09:00:00Z",
  clockedOutAt: "2026-09-15T17:00:00Z",
  updates: [{ kind: "material_progress", text: "Shipped the handoff", at: "2026-09-15T12:00:00Z" }],
  completed: ["Reconcile the settlement"],
  carried: [],
  blockers: [],
  commitments: [],
  observed: [
    { at: "2026-09-15T11:40:00Z", text: "A browser window shows the settlement dashboard.", app: "Google Chrome" },
    { at: "2026-09-15T14:10:00Z", text: "A terminal window shows test output.", app: "Windows Terminal Host" },
  ],
  media: [
    { at: "2026-09-15T16:30:00Z", title: "Settlement walkthrough", url: "https://www.loom.com/share/912e89a68ccc42c5ab5096fec7cd63d6", durationSeconds: 326, digest: "Walked through the settlement reconciliation and the two pending approvals.", transcriptChars: 4820 },
  ],
};

test("the draft prompt offers screenshot observations as selectable facts", () => {
  const prompt = buildEodPrompt(grounding);
  assert.match(prompt, /Observed activity context/);
  assert.match(prompt, /observed:0: A browser window shows the settlement dashboard\. \(observed in Google Chrome\)/);
  assert.match(prompt, /observedFactIds/);
});

test("observed facts are validated and only own ids survive", () => {
  const selection = parseEodSelection({
    summaryFactIds: [],
    completedFactIds: [],
    carriedFactIds: [],
    blockerFactIds: [],
    observedFactIds: ["observed:1", "observed:99"],
    mediaFactIds: [],
  }, grounding);
  assert.ok(selection);
  assert.deepEqual(selection.observedFactIds, ["observed:1"]);
  assert.equal(parseEodSelection({
    summaryFactIds: [], completedFactIds: [], carriedFactIds: [], blockerFactIds: [], mediaFactIds: [],
  }, grounding), null);
});

test("Loom media facts are offered, validated, and rendered with their limitation", () => {
  const prompt = buildEodPrompt(grounding);
  assert.match(prompt, /Recorded Loom updates/);
  assert.match(prompt, /media:0: Settlement walkthrough \(5:26\) — Walked through the settlement reconciliation and the two pending approvals\./);
  assert.match(prompt, /mediaFactIds/);

  const selection = parseEodSelection({
    summaryFactIds: [],
    completedFactIds: [],
    carriedFactIds: [],
    blockerFactIds: [],
    observedFactIds: [],
    mediaFactIds: ["media:0", "media:9"],
  }, grounding);
  assert.ok(selection);
  assert.deepEqual(selection.mediaFactIds, ["media:0"]);

  const markdown = renderEodSelection({
    summaryFactIds: ["update:0"],
    completedFactIds: ["completed:0"],
    carriedFactIds: [],
    blockerFactIds: [],
    observedFactIds: [],
    mediaFactIds: ["media:0"],
  }, grounding);
  assert.match(markdown, /## Recorded Loom updates/);
  assert.match(markdown, /Settlement walkthrough \(5:26\).*https:\/\/www\.loom\.com\/share\/912e89a68ccc42c5ab5096fec7cd63d6/);
  assert.match(markdown, /do not by themselves prove task completion/);

  const withoutMedia = renderEodSelection({
    summaryFactIds: [], completedFactIds: [], carriedFactIds: [], blockerFactIds: [], observedFactIds: [], mediaFactIds: [],
  }, { ...grounding, media: [] });
  assert.doesNotMatch(withoutMedia, /## Recorded Loom updates/);
});

test("selected observations render with the neutral limitation note", () => {
  const markdown = renderEodSelection({
    summaryFactIds: ["update:0"],
    completedFactIds: ["completed:0"],
    carriedFactIds: [],
    blockerFactIds: [],
    observedFactIds: ["observed:0"],
    mediaFactIds: [],
  }, grounding);
  assert.match(markdown, /## Observed activity context/);
  assert.match(markdown, /A browser window shows the settlement dashboard\./);
  assert.match(markdown, /does not prove attendance, productivity, or task completion/);
  assert.doesNotMatch(markdown, /terminal window shows test output/);
});

test("no observations means no observed section", () => {
  const markdown = renderEodSelection({
    summaryFactIds: [], completedFactIds: [], carriedFactIds: [], blockerFactIds: [], observedFactIds: [], mediaFactIds: [],
  }, { ...grounding, observed: [] });
  assert.doesNotMatch(markdown, /## Observed activity context/);
});

test("deterministic evidence lines carry the neutral observation summary", () => {
  const lines = eodLineItems([
    { id: "e1", title: "Worktivity screenshot context", summary: "A browser window shows the settlement dashboard." },
    { id: "e2", title: "Completed Nifty task" },
    { id: "e3", title: "Worktivity activity: Preview Employee", summary: "Worktivity activity: Preview Employee" },
  ], "none");
  assert.deepEqual(lines, [
    "- Worktivity screenshot context — A browser window shows the settlement dashboard.",
    "- Completed Nifty task",
    "- Worktivity activity: Preview Employee",
  ]);
  assert.deepEqual(eodLineItems([], "No Worktivity activity context was recorded."), ["- No Worktivity activity context was recorded."]);
});
