import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignalSpirit } from "./SignalSpirit";

describe("SignalSpirit", () => {
  it("renders lifecycle-specific working details", () => {
    const markup = renderToStaticMarkup(<SignalSpirit pose="think" />);
    expect(markup).toContain('data-pose="think"');
    expect(markup).toContain("signal-spirit-tail");
    expect(markup).toContain("signal-spirit-thought");
    expect(markup).toContain("signal-spirit-beacon");
  });

  it("uses the compact crop without full-body secondary motion", () => {
    const markup = renderToStaticMarkup(<SignalSpirit crop="head" pose="focus" />);
    expect(markup).toContain('data-crop="head"');
    expect(markup).not.toContain("signal-spirit-tail");
    expect(markup).not.toContain("signal-spirit-shadow");
    expect(markup).toContain("signal-spirit-face");
  });

  it("exposes late tone as a semantic palette state", () => {
    const markup = renderToStaticMarkup(<SignalSpirit tone="late" pose="focus" />);
    expect(markup).toContain('data-tone="late"');
    expect(markup).toContain("signal-spirit-late");
  });

  it("renders celebration one-shot affordances", () => {
    const markup = renderToStaticMarkup(<SignalSpirit pose="celebrate" />);
    expect(markup).toContain("signal-spirit-sparks");
    expect(markup).toContain("signal-spirit-smile");
  });
});
