import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioOtto } from "./StudioOtto";
import { MASCOT_POSES, type MascotCrop } from "./mascotTypes";
import { MASCOT } from "./mascot";
import { MascotPet } from "./MascotPet";
import { studioOttoPalette } from "./studioOttoPalette";

const render = (pose: (typeof MASCOT_POSES)[number], crop: MascotCrop = "full", tone: "signal" | "late" = "signal") =>
  renderToStaticMarkup(<StudioOtto pose={pose} crop={crop} tone={tone} />);

describe("Studio Otto", () => {
  it("is the configured mark and pet without changing stored identity", () => {
    expect(MASCOT.id).toBe("otto");
    expect(MASCOT.name).toBe("Otto");
    expect(MASCOT.Mark).toBe(StudioOtto);
    expect(MASCOT.Pet).toBe(StudioOtto);
  });

  it.each(MASCOT_POSES)("renders %s across all crops and tones", (pose) => {
    for (const crop of ["full", "orb", "head"] as const) {
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

  it("uses a simplified full-silhouette crop for the floating orb", () => {
    const html = render("think", "orb", "late");
    expect(html).toContain('data-crop="orb"');
    expect(html).toContain('viewBox="10 8 140 168"');
    expect(html).toContain("studio-chassis");
    expect(html).toContain("studio-terminal-working");
    expect(html).toContain("studio-late");
    expect(html).not.toMatch(/studio-taskpad|studio-working-arms|studio-screen-texture|studio-vents|<filter/);
  });

  it("conveys activity with glyphs and gestures, not color alone", () => {
    expect(render("think")).toContain("studio-terminal-working");
    expect(render("think")).toContain("studio-taskpad");
    expect(render("alert")).toContain("studio-terminal-question");
    expect(render("celebrate")).toContain("studio-terminal-ready");
    expect(render("recover")).toContain("studio-terminal-error");
    expect(render("sleep")).toContain("studio-terminal-rest");
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
    expect(css).not.toContain("studio-work-rig 600ms");
    expect(css).toContain("studio-attention-rig 780ms steps(5, end) 1 both");
    expect(css).not.toMatch(/will-change:\s*transform/);
  });
});
