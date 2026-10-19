import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecapPrompter } from "./RecapPrompter";
import type { RecapSpeechLine } from "./recapSpeech";

const lines: RecapSpeechLine[] = [
  { text: "Software-development review across three repositories.", time: null },
  { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
  { text: "Read the blocker notes", time: null },
  { text: "Checked the review queue for pending reports", time: null },
];

const render = (props: Partial<Parameters<typeof RecapPrompter>[0]> = {}) => renderToStaticMarkup(createElement(RecapPrompter, {
  lines,
  progress: 0.5,
  activeIndex: 1,
  reduced: false,
  ...props,
}));

describe("the recap prompter", () => {
  it("shows every line and marks exactly the one being spoken", () => {
    const markup = render();
    expect(markup.match(/data-active="true"/g)).toHaveLength(1);
    expect(markup.match(/recap-prompter-line/g)).toHaveLength(lines.length);
    expect(markup).toContain("Reviewed the cursor-pagination code");
    expect(markup).toContain("<time>7:21 PM</time>");
    // The slide itself is measured from the rendered rows, so a server render
    // carries the track and the progress it was given; the browser check in the
    // verification task watches the window move.
    expect(markup).toContain("recap-prompter-track");
    expect(markup).toContain('data-progress="0.500"');
  });

  it("reports progress on the audio's clock, not on a timer of its own", () => {
    expect(render({ progress: 0.25 })).toContain("width:25%");
    expect(render({ progress: 0.8 })).toContain("width:80%");
    expect(render({ progress: 1 })).toContain("width:100%");
    expect(render({ progress: -1 })).toContain("width:0%");
    expect(render({ progress: 4 })).toContain("width:100%");
  });

  it("keeps every meaning under reduced motion and drops the slide", () => {
    const markup = render({ reduced: true });
    expect(markup).toContain('data-reduced="true"');
    expect(markup).not.toContain("translateY");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Reviewed the cursor-pagination code");
  });

  it("renders nothing at all when there are no words", () => {
    expect(render({ lines: [] })).toBe("");
  });

  it("styles itself from the bubble's own dark palette", () => {
    const css = readFileSync(new URL("./avatar.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.recap-prompter-window\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.recap-prompter-line\s*\{[^}]*color:\s*#8e9686/);
    expect(css).toMatch(/\.recap-prompter-line\[data-active="true"\]\s*\{[^}]*color:\s*#f4f5ee/);
    expect(css).toMatch(/\.recap-prompter-progress i\s*\{[^}]*background:\s*#d5ff54/);
    expect(css).toMatch(/\[data-reduced="true"\] \.recap-prompter-track\s*\{[^}]*transition:\s*none/);
  });
});
