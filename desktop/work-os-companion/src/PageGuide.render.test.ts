import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PageGuide from "./PageGuide";
import { GUIDE_FILMS } from "./guideFilms";
import { GUIDE_VIEWS } from "./guideState";
import { PAGE_GUIDES } from "./guides";

const publicFile = (path: string) => fileURLToPath(new URL(`../public/${path}`, import.meta.url));

describe("page guide modal", () => {
  it("renders dialog semantics, chapter controls, and the opening clip", () => {
    const markup = renderToStaticMarkup(createElement(PageGuide, {
      view: "day",
      autoOpen: true,
      onClose: () => undefined,
      onDisableAutoOpen: () => undefined,
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="page-guide-title"');
    expect(markup).toContain('aria-describedby="page-guide-promise"');
    expect(markup).toContain("How My Day works");
    expect(markup).toContain("Your workday in one place");

    // The film is the guide's illustration, and the first step's clip is what
    // plays before anything is chosen.
    expect(markup).toContain('id="page-guide-art"');
    expect(markup).toContain('data-guide-view="day"');
    expect(markup).toContain(`src="${GUIDE_FILMS.day[0]!.file}"`);
    expect(markup).toContain(`src="${GUIDE_FILMS.day[0]!.poster}"`);
    expect(markup).toContain('aria-controls="page-guide-art"');

    // The film is decorative to assistive technology: the steps state
    // everything it shows, in words, and that is the accessible path.
    const video = markup.slice(markup.indexOf("<video"));
    expect(video.slice(0, video.indexOf(">"))).toContain('aria-hidden="true"');

    expect((markup.match(/class="guide-step-control/g) ?? []).length).toBe(PAGE_GUIDES.day.steps.length);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Start with a plan");
    expect(markup).toContain("Got it");
    expect(markup).toContain("show these automatically");
    expect(markup).toContain('aria-label="Close page guide"');
  });

  it("states the opt-out is active instead of offering it again", () => {
    const markup = renderToStaticMarkup(createElement(PageGuide, {
      view: "settings",
      autoOpen: false,
      onClose: () => undefined,
      onDisableAutoOpen: () => undefined,
    }));
    expect(markup).toContain("Automatic guides are off.");
    expect(markup).not.toContain("show these automatically");
  });

  it("renders a developer replay without changing guide preferences", () => {
    const markup = renderToStaticMarkup(createElement(PageGuide, {
      view: "insights",
      autoOpen: true,
      developerPreview: true,
      onClose: () => undefined,
      onDisableAutoOpen: () => undefined,
    }));
    expect(markup).toContain("Developer preview");
    expect(markup).toContain("Guide state stays unchanged");
    expect(markup).not.toContain("show these automatically");
    expect(markup).not.toContain("Automatic guides are off.");
  });

  it("renders every guided page with its own film", () => {
    for (const view of GUIDE_VIEWS) {
      const markup = renderToStaticMarkup(createElement(PageGuide, {
        view,
        autoOpen: true,
        onClose: () => undefined,
        onDisableAutoOpen: () => undefined,
      }));
      expect(markup).toContain(PAGE_GUIDES[view].title);
      expect(markup).toContain(`data-guide-view="${view}"`);
      expect(markup).toContain(`src="${GUIDE_FILMS[view][0]!.file}"`);
      expect(markup).not.toContain("guide-film is-missing");
    }
  });
});

/**
 * The film list is generated from what was actually shot, so these three checks
 * are what keep the generated list honest: one clip per step, every clip really
 * on disk beside its still, and every clip long enough to have been a take
 * rather than a stub.
 */
describe("guide films", () => {
  it("has exactly one clip per step of every guide", () => {
    for (const view of GUIDE_VIEWS) {
      expect(GUIDE_FILMS[view], `${view} has no films`).toBeDefined();
      expect(GUIDE_FILMS[view].length, `${view} has ${GUIDE_FILMS[view].length} clips for ${PAGE_GUIDES[view].steps.length} steps`).toBe(PAGE_GUIDES[view].steps.length);
    }
  });

  it("has every clip and still on disk", () => {
    for (const view of GUIDE_VIEWS) {
      for (const film of GUIDE_FILMS[view]) {
        expect(existsSync(publicFile(film.file)), `missing ${film.file}`).toBe(true);
        expect(existsSync(publicFile(film.poster)), `missing ${film.poster}`).toBe(true);
      }
    }
  });

  it("names each clip after the step it illustrates", () => {
    for (const view of GUIDE_VIEWS) {
      GUIDE_FILMS[view].forEach((film, index) => {
        expect(film.chapter, `${view} clip ${index + 1}`).toBe(PAGE_GUIDES[view].steps[index]!.title);
        expect(film.seconds, `${view} clip ${index + 1} is too short to be a take`).toBeGreaterThan(1.5);
      });
    }
  });

  it("keeps the whole set inside the budget the blueprint states", () => {
    let total = 0;
    for (const view of GUIDE_VIEWS) {
      for (const film of GUIDE_FILMS[view]) {
        total += statSync(publicFile(film.file)).size + statSync(publicFile(film.poster)).size;
      }
    }
    // §14.1: the five-page set stays under 4 MB, because it ships in the
    // installer and is downloaded chapter by chapter afterwards.
    expect(total, `${(total / 1024 / 1024).toFixed(2)} MB of guide film`).toBeLessThan(4 * 1024 * 1024);
  });
});
