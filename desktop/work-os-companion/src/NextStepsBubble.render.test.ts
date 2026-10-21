import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextStepsBubble, nextStepsResultLine } from "./NextStepsBubble";
import { IDLE_RECAP_SPEECH, type RecapSpeechSnapshot } from "./recapSpeechPlayer";
import type { RecapNextStepsMoment } from "./RecapNextStepsCard";

const items = [
  { proposalId: "p-1", operation: "complete_task" as const, status: "pending", title: "Wire GitHub context", rationale: "The tests pass and the card renders.", taskId: "task-1", editable: false },
  { proposalId: "p-2", operation: "create_task" as const, status: "pending", title: "Deploy the recap release", rationale: "The release cut is a concrete deliverable.", taskId: null, editable: true },
  { proposalId: "p-3", operation: "add_subtask" as const, status: "pending", title: "Verify the drawer on staging", rationale: "The drawer shipped untested.", taskId: "task-2", editable: true },
];

const moment = (overrides: Partial<RecapNextStepsMoment> = {}): RecapNextStepsMoment => ({
  intervalId: "interval-1",
  label: "2:17–3:17 PM",
  status: "ready",
  items,
  states: {},
  failures: {},
  ...overrides,
});

const speech = (overrides: Partial<RecapSpeechSnapshot> = {}): RecapSpeechSnapshot => ({
  ...IDLE_RECAP_SPEECH,
  status: "playing",
  lines: [
    { text: "Next steps from your 2:17–3:17 PM recap.", time: null, ref: "lead" },
    { text: "Wire GitHub context", time: null, ref: "p-1:title" },
    { text: "The tests pass and the card renders.", time: null, ref: "p-1:why" },
  ],
  activeIndex: 1,
  intervalId: "interval-1",
  ...overrides,
});

const render = (overrides: {
  moment?: Partial<RecapNextStepsMoment>;
  speech?: Partial<RecapSpeechSnapshot>;
  voiceAvailable?: boolean;
} = {}) => renderToStaticMarkup(createElement(NextStepsBubble, {
  moment: moment(overrides.moment),
  busy: false,
  speech: speech(overrides.speech),
  voiceAvailable: overrides.voiceAvailable ?? true,
  reduced: false,
  onDecide: () => undefined,
  onRetry: () => undefined,
  onListen: () => undefined,
  onStopListening: () => undefined,
  onDismiss: () => undefined,
}));

describe("NextStepsBubble", () => {
  it("shows the wait state while the suggestions generate", () => {
    const markup = render({ moment: { status: "drafting", items: [] }, speech: { status: "idle", lines: [] } });
    expect(markup).toContain("Next steps");
    expect(markup).toContain("From your 2:17–3:17 PM recap");
    expect(markup).toContain("Working out what could come next");
    expect(markup).toContain("Otto is reading your recap for anything worth doing.");
    expect(markup).toContain("data-phase=\"drafting\"");
    // No decision controls before there is anything to decide.
    expect(markup).not.toContain("Mark done");
    expect(markup).not.toContain("Listen");
  });

  it("renders each suggestion with its kind, title, reason, and own controls", () => {
    const markup = render({ speech: { status: "idle", lines: [] } });
    expect(markup).toContain("Mark done");
    expect(markup).toContain("Wire GitHub context");
    expect(markup).toContain("The tests pass and the card renders.");
    expect(markup).toContain("New task");
    expect(markup).toContain("Add task");
    expect(markup).toContain("Edit");
    expect(markup).toContain("Add subtask");
    expect(markup).toContain("Skip");
    expect(markup).toContain("Listen");
    // No bulk acceptance: every item keeps its own accept control.
    expect(markup).not.toContain("Apply all");
  });

  it("offers no Listen when the workspace cannot read aloud", () => {
    const markup = render({ voiceAvailable: false, speech: { status: "idle", lines: [] } });
    expect(markup).not.toContain(">Listen<");
  });

  it("marks the row being spoken instead of replacing the list", () => {
    const markup = render();
    expect(markup).toContain("data-active=\"true\"");
    expect(markup).toContain("Stop reading");
    expect(markup).toContain("is-speaking");
    // The controls stay reachable while Otto reads.
    expect(markup).toContain("Skip");
  });

  it("counts the settled list and shows the success line", () => {
    const done = moment({
      status: "done",
      states: { "p-1": "applied", "p-2": "applied", "p-3": "skipped" },
    });
    expect(nextStepsResultLine(done)).toBe("2 changes applied · 1 skipped");
    const markup = render({
      moment: { status: "done", states: { "p-1": "applied", "p-2": "applied", "p-3": "skipped" } },
      speech: { status: "idle", lines: [] },
    });
    expect(markup).toContain("2 changes applied");
    expect(markup).toContain("avatar-next-steps-check");
    // A decided row reports its outcome instead of offering the action again.
    expect(markup).toContain("Added ✓");
    expect(markup).toContain("Skipped");
  });

  it("keeps a failed item retryable and never claims success", () => {
    const failed = moment({
      status: "done",
      states: { "p-1": "failed", "p-2": "applied", "p-3": "skipped" },
      failures: { "p-1": "The task was already closed." },
    });
    expect(nextStepsResultLine(failed)).toContain("1 failed");
    const markup = render({
      moment: {
        status: "done",
        states: { "p-1": "failed", "p-2": "applied", "p-3": "skipped" },
        failures: { "p-1": "The task was already closed." },
      },
      speech: { status: "idle", lines: [] },
    });
    expect(markup).toContain("The task was already closed.");
    expect(markup).toContain("Retry");
    expect(markup).not.toContain("avatar-next-steps-check");
  });

  it("says when nothing came of the recap", () => {
    const markup = render({ moment: { status: "empty", items: [] }, speech: { status: "idle", lines: [] } });
    expect(markup).toContain("Nothing new to action");
  });
});
