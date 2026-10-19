import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MascotPet } from "./MascotPet";
import { StudioOtto } from "./StudioOtto";

describe("Otto reading aloud", () => {
  it("moves the mouth without inventing a new pose", () => {
    const speaking = renderToStaticMarkup(createElement(StudioOtto, { pose: "focus", speaking: true }));
    expect(speaking).toContain('data-speaking="true"');
    expect(speaking).toContain("studio-speak-mouth");
    expect(speaking).toContain('data-pose="focus"');

    const quiet = renderToStaticMarkup(createElement(StudioOtto, { pose: "focus" }));
    expect(quiet).not.toContain("studio-speak-mouth");
    expect(quiet).not.toContain("data-speaking");
    // The resting face keeps its own glyphs when nothing is being read.
    expect(quiet).toContain("studio-prompt");
  });

  it("keeps a working pose's own face and leaves the speech to the bubble", () => {
    const working = renderToStaticMarkup(createElement(StudioOtto, { pose: "think", speaking: true }));
    expect(working).not.toContain("studio-speak-mouth");
    expect(working).toContain("studio-terminal-working");
  });

  it("reaches the floating companion through MascotPet", () => {
    const markup = renderToStaticMarkup(createElement(MascotPet, { isolated: true, speaking: true }));
    expect(markup).toContain('data-speaking="true"');
  });

  it("honours reduced motion by holding the mouth still", () => {
    const css = readFileSync(new URL("./studio-otto.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.studio-speak-mouth\s*\{[^}]*animation:\s*studio-speak/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]{0,120}\.studio-speak-mouth \{ animation: none/);
  });

  it("does not add a pose: the mascot's pose set stays as it is", () => {
    const types = readFileSync(new URL("./mascotTypes.ts", import.meta.url), "utf8");
    expect(types).toContain('export const MASCOT_POSES = ["idle", "sleep", "focus", "alert", "rest", "think", "celebrate", "recover"] as const;');
    expect(types).toMatch(/speaking\?: boolean;/);
  });
});
