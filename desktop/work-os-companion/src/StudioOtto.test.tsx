import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioOtto } from "./StudioOtto";
import { MASCOT_POSES } from "./mascotTypes";
import { MASCOT } from "./mascot";
import { MascotPet } from "./MascotPet";
import { studioOttoPalette } from "./studioOttoPalette";

const render = (pose: (typeof MASCOT_POSES)[number], crop: "full" | "head" = "full", tone: "signal" | "late" = "signal") =>
  renderToStaticMarkup(<StudioOtto pose={pose} crop={crop} tone={tone} />);

describe("Studio Otto", () => {
  it("is the configured mark and pet without changing stored identity", () => {
    expect(MASCOT.id).toBe("otto");
    expect(MASCOT.name).toBe("Otto");
    expect(MASCOT.Mark).toBe(StudioOtto);
    expect(MASCOT.Pet).toBe(StudioOtto);
  });

  it.each(MASCOT_POSES)("renders %s across both crops and tones", (pose) => {
    for (const crop of ["full", "head"] as const) {
      for (const tone of ["signal", "late"] as const) {
        const html = render(pose, crop, tone);
        expect(html).toContain(`data-pose="${pose}"`);
        expect(html).toContain(`data-tone="${tone}"`);
        expect(html).toContain(`data-crop="${crop}"`);
        expect(html).toContain('role="img"');
        expect(html).toContain('focusable="false"');
        expect(html).not.toMatch(/NaN|undefined|<image\b|<text\b/);
      }
    }
  });

  it("uses neutral/yellow/green/red without recoloring the entire casing", () => {
    expect(studioOttoPalette("idle", "signal")).toBe("neutral");
    expect(studioOttoPalette("focus", "signal")).toBe("neutral");
    expect(studioOttoPalette("rest", "signal")).toBe("neutral");
    expect(studioOttoPalette("think", "signal")).toBe("working");
    expect(studioOttoPalette("alert", "signal")).toBe("working");
    expect(studioOttoPalette("celebrate", "signal")).toBe("ready");
    expect(studioOttoPalette("recover", "signal")).toBe("blocked");
  });

  it("keeps late as a secondary badge during work and completion", () => {
    expect(studioOttoPalette("think", "late")).toBe("working");
    expect(studioOttoPalette("celebrate", "late")).toBe("ready");
    expect(studioOttoPalette("focus", "late")).toBe("blocked");
    expect(render("think", "full", "late")).toContain("studio-late");
  });

  it("omits limbs, props, blur filters, texture and clock badges from compact marks", () => {
    for (const pose of MASCOT_POSES) {
      const html = render(pose, "head", "late");
      expect(html).toContain('viewBox="9 10 142 110"');
      expect(html).toContain("studio-head");
      expect(html).not.toMatch(/studio-chassis|studio-taskpad|studio-late|studio-shadow|studio-screen-texture|<filter/);
    }
  });

  it("conveys activity with glyphs and gestures, not color alone", () => {
    expect(render("think")).toContain("studio-terminal-working");
    expect(render("think")).toContain("studio-taskpad");
    expect(render("alert")).toContain("studio-terminal-question");
    expect(render("celebrate")).toContain("studio-terminal-ready");
    expect(render("recover")).toContain("studio-terminal-error");
    expect(render("sleep")).toContain("studio-terminal-rest");
  });

  it("shows deep-blue sleep marks only on full resting figures", () => {
    const sleep = render("sleep");
    expect(sleep).toContain("studio-sleep-zs");
    expect(sleep).toContain('d="M121 41h11l-11 11h11"');
    expect(sleep).toContain('d="M140 8h16l-16 16h16"');
    expect(render("rest")).toContain("studio-sleep-zs");
    expect(render("idle")).not.toContain("studio-sleep-zs");
    expect(render("focus")).not.toContain("studio-sleep-zs");
    expect(render("sleep", "head")).not.toContain("studio-sleep-zs");

    const css = readFileSync(new URL("./studio-otto.css", import.meta.url), "utf8");
    expect(css).toContain("--studio-sleep-blue: #2f54d7");
    expect(css).toContain("stroke-width: 3.2");
    expect(css).toContain("studio-sleep-drift 4.8s ease-in-out infinite");
  });

  it("has unique SVG resource ids for multiple instances", () => {
    const html = renderToStaticMarkup(<><StudioOtto /><StudioOtto pose="think" /><StudioOtto crop="head" /></>);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(match[1]);
  });

  it("preserves caller sizing, class and accessible label", () => {
    const html = renderToStaticMarkup(<StudioOtto style={{ width: 96, height: 108 }} className="custom-art" ariaLabel="Otto is working" />);
    expect(html).toContain("custom-art");
    expect(html).toContain("width:96px;height:108px");
    expect(html).toContain('aria-label="Otto is working"');
  });

  it("integrates through the reviewed state adapter", () => {
    const html = renderToStaticMarkup(<MascotPet agent="working" workday="late" />);
    expect(html).toContain('data-motion="renderer"');
    expect(html).toContain('data-activity="working"');
    expect(html).toContain('data-workday="late"');
    expect(html).toContain('data-palette="working"');
    expect(html).toContain("studio-late");
  });

  it("ships self-contained static art and guards against animation regressions", () => {
    for (const path of [MASCOT.assets.mark, MASCOT.assets.companion]) {
      const svg = readFileSync(new URL(`../public${path}`, import.meta.url), "utf8");
      expect(svg).toContain('data-static="true"');
      expect(svg).toContain("studio-head");
      expect(svg).not.toMatch(/<script|<image|@import/);
    }
    const css = readFileSync(new URL("./studio-otto.css", import.meta.url), "utf8");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(".mascot-lab.reduced-motion");
    expect(css).toContain('[data-crop="head"] *');
    expect(css).toContain('data-motion="renderer"');
    expect(css).not.toMatch(/will-change:\s*transform/);
  });
});
