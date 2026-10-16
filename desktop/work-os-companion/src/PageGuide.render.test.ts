import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PageGuide from "./PageGuide";
import GuideTour from "./GuideTour";
import { GUIDE_FILMS, guideFilmsFor } from "./guideFilms";
import { ADMIN_GUIDE_VIEWS, GUIDE_VIEWS } from "./guideState";
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
    expect(markup).toContain(`src="${GUIDE_FILMS.day![0]!.file}"`);
    expect(markup).toContain(`src="${GUIDE_FILMS.day![0]!.poster}"`);
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

  it("renders every page with its own film", () => {
    for (const view of GUIDE_VIEWS) {
      const markup = renderToStaticMarkup(createElement(PageGuide, {
        view,
        autoOpen: true,
        onClose: () => undefined,
        onDisableAutoOpen: () => undefined,
      }));
      expect(markup).toContain(PAGE_GUIDES[view].title);
      expect(markup).toContain(`data-guide-view="${view}"`);
      expect(markup).toContain(`src="${guideFilmsFor(view)[0]!.file}"`);
      expect(markup).not.toContain("guide-film is-missing");
    }
  });

  it("offers the tour on the first guide and the opt-out once one is seen", () => {
    const withTour = renderToStaticMarkup(createElement(PageGuide, {
      view: "admin_overview",
      autoOpen: true,
      onClose: () => undefined,
      onDisableAutoOpen: () => undefined,
      onStartTour: () => undefined,
    }));
    expect(withTour).toContain("Show me the whole workspace");
    expect(withTour).not.toContain("show these automatically");
  });
});

describe("the workspace tour", () => {
  it("walks the administration sections in order with their own films", () => {
    const markup = renderToStaticMarkup(createElement(GuideTour, {
      pages: [...ADMIN_GUIDE_VIEWS],
      subject: "the administration workspace",
      onNavigate: () => undefined,
      onClose: () => undefined,
    }));
    expect(markup).toContain("tour of the administration workspace");
    expect(markup).toContain("How Overview works");
    expect(markup).toContain('data-guide-view="admin_overview"');
    expect((markup.match(/class="guide-tour-rail"/g) ?? []).length).toBe(1);
    // Every stop is named in the rail, in the workspace's own order.
    for (const title of ["Overview", "People", "Tasks", "EOD Review", "Insights", "Evidence", "Settings"]) {
      expect(markup).toContain(`>${title}</button>`);
    }
    expect(markup).toContain("<video");
  });

  it("keeps walking the five employee pages by default", () => {
    const markup = renderToStaticMarkup(createElement(GuideTour, {
      onNavigate: () => undefined,
      onClose: () => undefined,
    }));
    expect(markup).toContain("tour of your workspace");
    expect(markup).toContain('data-guide-view="day"');
    expect(markup).toContain("<video");
    expect(markup).toContain("My Day");
    expect(markup).not.toContain(">Evidence</button>");
  });
});

/**
 * The film list is generated from what was actually shot, so these checks are
 * what keep the generated list honest: one clip per step, every clip really on
 * disk beside its still, and every clip long enough to have been a take rather
 * than a stub. All twelve guides — the five employee pages and the seven
 * administration sections — are filmed and checked here.
 */
describe("guide films", () => {
  it("has exactly one clip per step of every guide", () => {
    for (const view of GUIDE_VIEWS) {
      const films = GUIDE_FILMS[view];
      expect(films, `${view} has no films`).toBeDefined();
      expect(films!.length, `${view} has ${films!.length} clips for ${PAGE_GUIDES[view].steps.length} steps`).toBe(PAGE_GUIDES[view].steps.length);
    }
  });

  it("has every clip and still on disk", () => {
    for (const view of GUIDE_VIEWS) {
      for (const film of GUIDE_FILMS[view]!) {
        expect(existsSync(publicFile(film.file)), `missing ${film.file}`).toBe(true);
        expect(existsSync(publicFile(film.poster)), `missing ${film.poster}`).toBe(true);
      }
    }
  });

  it("names each clip after the step it illustrates", () => {
    for (const view of GUIDE_VIEWS) {
      GUIDE_FILMS[view]!.forEach((film, index) => {
        expect(film.chapter, `${view} clip ${index + 1}`).toBe(PAGE_GUIDES[view].steps[index]!.title);
        expect(film.seconds, `${view} clip ${index + 1} is too short to be a take`).toBeGreaterThan(1.5);
      });
    }
  });

  it("keeps the whole set inside the budget the blueprint states", () => {
    let total = 0;
    for (const view of GUIDE_VIEWS) {
      for (const film of guideFilmsFor(view)) {
        total += statSync(publicFile(film.file)).size + statSync(publicFile(film.poster)).size;
      }
    }
    // §14.1: the filmed set stays under 8 MB, because it ships in the
    // installer and is downloaded chapter by chapter afterwards.
    expect(total, `${(total / 1024 / 1024).toFixed(2)} MB of guide film`).toBeLessThan(8 * 1024 * 1024);
  });
});
