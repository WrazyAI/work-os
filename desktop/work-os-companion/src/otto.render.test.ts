import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Otto, type OttoPose } from "./Otto";

const POSES: OttoPose[] = ["idle", "sleep", "focus", "alert", "rest", "think", "celebrate", "recover"];

describe("Otto, the Work OS companion", () => {
  it("renders a distinct visor for every pose", () => {
    const renderings = new Set<string>();
    for (const pose of POSES) {
      const markup = renderToStaticMarkup(createElement(Otto, { pose }));
      expect(markup).toContain(`data-pose="${pose}"`);
      expect(markup).toContain(`Otto, the Work OS companion, ${pose}`);
      renderings.add(markup);
    }
    expect(renderings.size).toBe(POSES.length);
  });

  it("celebrates with sparkles and recovers with a concern mark", () => {
    expect(renderToStaticMarkup(createElement(Otto, { pose: "celebrate" }))).toContain("otto-sparkles");
    expect(renderToStaticMarkup(createElement(Otto, { pose: "recover" }))).toContain("otto-concern");
  });

  it("cycles three dots while thinking and closes the visor while sleeping", () => {
    const thinking = renderToStaticMarkup(createElement(Otto, { pose: "think" }));
    expect((thinking.match(/otto-dot/g) || []).length).toBe(3);
    const sleeping = renderToStaticMarkup(createElement(Otto, { pose: "sleep" }));
    expect(sleeping).toContain("otto-line");
    expect(sleeping).not.toContain("otto-eye");
  });

  it("carries the late tone with a clock mark and an accessible label", () => {
    const late = renderToStaticMarkup(createElement(Otto, { pose: "focus", tone: "late" }));
    expect(late).toContain('data-tone="late"');
    expect(late).toContain("otto-late-mark");
    expect(late).toContain("late start needs a reason");
    const signal = renderToStaticMarkup(createElement(Otto, { pose: "focus" }));
    expect(signal).toContain('data-tone="signal"');
    expect(signal).not.toContain("otto-late-mark");
  });
});
