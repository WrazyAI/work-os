import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecapNextStepsCard, type RecapNextStepsMoment } from "./RecapNextStepsCard";

const items = [
  { proposalId: "p-1", operation: "complete_task" as const, status: "pending", title: "Wire GitHub context", rationale: "The tests pass and the card renders.", taskId: "task-1", editable: false },
  { proposalId: "p-2", operation: "create_task" as const, status: "pending", title: "Deploy the recap release", rationale: "The release cut is a concrete deliverable.", taskId: null, editable: true },
  { proposalId: "p-3", operation: "add_subtask" as const, status: "pending", title: "Verify the drawer on staging", rationale: "The drawer shipped untested.", taskId: "task-2", editable: true },
];

const moment = (overrides: Partial<RecapNextStepsMoment>): RecapNextStepsMoment => ({
  intervalId: "interval-1",
  label: "2:17–3:17 PM",
  status: "ready",
  items,
  states: {},
  failures: {},
  ...overrides,
});

describe("RecapNextStepsCard", () => {
  it("shows the drafting state while the recap's suggestions generate", () => {
    const markup = renderToStaticMarkup(createElement(RecapNextStepsCard, {
      moment: moment({ status: "drafting", items: [] }),
      onDecide: () => undefined,
    }));
    expect(markup).toContain("Next steps");
    expect(markup).toContain("From your 2:17–3:17 PM recap");
    expect(markup).toContain("Drafting next steps from your recap…");
  });

  it("renders each suggestion with its kind, rationale, and inline actions", () => {
    const markup = renderToStaticMarkup(createElement(RecapNextStepsCard, {
      moment: moment({}),
      onDecide: () => undefined,
    }));
    expect(markup).toContain("Mark done");
    expect(markup).toContain("New task");
    expect(markup).toContain("Subtask");
    expect(markup).toContain("Wire GitHub context");
    expect(markup).toContain("The tests pass and the card renders.");
    expect(markup).toContain("Deploy the recap release");
    expect(markup).toContain("Add task");
    expect(markup).toContain("Add subtask");
    // Only new task/subtask suggestions offer an inline title edit.
    expect(markup.match(/> Edit</g)?.length).toBe(2);
  });

  it("reports applied, skipped, and failed items with a settle summary", () => {
    const markup = renderToStaticMarkup(createElement(RecapNextStepsCard, {
      moment: moment({
        status: "done",
        states: { "p-1": "applied", "p-2": "skipped", "p-3": "failed" },
        failures: { "p-3": "The task changed after this suggestion was drafted." },
      }),
      onDecide: () => undefined,
    }));
    expect(markup).toContain("Done ✓");
    expect(markup).toContain("Skipped");
    expect(markup).toContain("Failed");
    expect(markup).toContain("The task changed after this suggestion was drafted.");
    expect(markup).toContain("1 change applied · 1 skipped · 1 failed");
    expect(markup).toContain("Retry");
  });

  it("stays quiet when nothing is actionable", () => {
    const markup = renderToStaticMarkup(createElement(RecapNextStepsCard, {
      moment: moment({ status: "empty", items: [] }),
      onDecide: () => undefined,
    }));
    expect(markup).toContain("Nothing new to action from this recap.");
    expect(markup).not.toContain("chat-next-steps-list");
  });
});
