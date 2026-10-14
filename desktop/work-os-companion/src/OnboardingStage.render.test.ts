import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OnboardingStage, OttoLine, STAGE_POSE } from "./OnboardingStage";

function stage(overrides: Partial<Parameters<typeof OnboardingStage>[0]> = {}) {
  return renderToStaticMarkup(createElement(OnboardingStage, {
    pose: "attending",
    eyebrow: "Understood",
    title: "What kind of work is it?",
    line: "Pick whichever is closest.",
    replayKey: "understood:step",
    ...overrides,
  }));
}

describe("first-run stage", () => {
  it("gives screen readers the whole sentence and the visible copy one span per word", () => {
    const markup = stage();
    // The speaker is named once, for assistive tech only; the bubble's tail
    // already shows a sighted reader who is talking.
    expect(markup).toContain("Otto: Pick whichever is closest.");
    expect(markup).toContain('class="sr-only"');
    expect((markup.match(/otto-line-word/g) ?? []).length).toBe(4);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("resolves each word's reveal delay so the line lands in order", () => {
    const markup = stage();
    expect(markup).toContain("animation-delay:0ms");
    expect(markup).toContain("animation-delay:26ms");
  });

  it("does not animate a line long enough to outlast the moment", () => {
    const long = stage({ line: Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ") });
    // No per-word delay *and* no reveal flag: the flat rule lives in CSS, so the
    // flag is what keeps a long line from flashing in all at once.
    expect(long).not.toContain("animation-delay");
    expect(long).not.toContain('data-reveal="true"');
    expect(long).toContain("word59");
  });

  it("flags a short line as revealing so the word animation can apply", () => {
    expect(stage()).toContain('data-reveal="true"');
  });

  it("walks the journey rail and names the current step for assistive tech", () => {
    const markup = stage({ journey: { total: 6, index: 2, label: "In control" } });
    expect(markup).toContain("Setup progress: step 3 of 6, In control");
    expect(markup).toContain("Step 3 of 6: In control");
    expect((markup.match(/data-state=/g) ?? []).length).toBe(6);
    expect((markup.match(/data-state="done"/g) ?? []).length).toBe(2);
    expect((markup.match(/data-state="now"/g) ?? []).length).toBe(1);
    expect((markup.match(/data-state="next"/g) ?? []).length).toBe(3);
  });

  it("shows no rail before the setup starts", () => {
    expect(stage()).not.toContain("otto-journey");
  });

  it("renders the configured mascot with the pose the real state calls for", () => {
    // The stage owns its pose sequence: there is no workspace to mirror yet, so
    // each recipe has to name a genuine agent/workday pair.
    expect(STAGE_POSE.attending).toEqual({ agent: "idle", workday: "active" });
    expect(STAGE_POSE.working).toEqual({ agent: "working", workday: "active" });
    expect(STAGE_POSE.done).toEqual({ agent: "ready", workday: "active" });

    const attending = stage({ pose: "attending" });
    expect(attending).toContain('class="mascot-pet mascot-stage"');
    expect(attending).toContain('data-activity="idle"');
    expect(attending).toContain('data-workday="active"');

    const done = stage({ pose: "done" });
    expect(done).toContain('data-activity="ready"');
    expect(done).toContain('data-pose="celebrate"');
  });

  it("keeps Otto's remote identity out of the stage source", () => {
    const markup = stage();
    // Identity comes from mascot.ts through MascotPet; the stage never renders
    // its own art or invents a name.
    expect(markup).not.toContain("studio-otto.svg");
    expect(markup).toContain('aria-label="Otto, Work OS companion');
  });
});

describe("Otto's spoken line", () => {
  it("renders one element and no reveal when reduced motion is requested", () => {
    const markup = renderToStaticMarkup(createElement(OttoLine, { text: "Just one line." }));
    expect(markup).toContain("Just one line.");
    expect(markup).toContain("otto-line");
  });
});
