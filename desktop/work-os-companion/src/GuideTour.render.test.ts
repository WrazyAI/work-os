import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GuideTour, { TOUR_PAGES, navigateTour } from "./GuideTour";
import PageGuide from "./PageGuide";
import GuideFilm, { nextGuideChapter } from "./GuideFilm";
import { GUIDE_FILMS } from "./guideFilms";
import { guideMayAutoplay, prefersReducedGuideMotion, subscribeToGuideMotion } from "./guideMotion";

afterEach(() => vi.unstubAllGlobals());

const renderTour = () => renderToStaticMarkup(createElement(GuideTour, {
  onNavigate: () => undefined,
  onClose: () => undefined,
}));

const renderPage = () => renderToStaticMarkup(createElement(PageGuide, {
  view: "day",
  autoOpen: true,
  onClose: () => undefined,
  onDisableAutoOpen: () => undefined,
}));

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => {
      expect(query).toBe("(prefers-reduced-motion: reduce)");
      return { matches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    },
  });
}

describe("guide video motion preference", () => {
  it("shows a still and explicit Play control in both page and workspace guides", () => {
    mockReducedMotion(true);
    const poster = GUIDE_FILMS.day[0]!.poster;
    for (const markup of [renderPage(), renderTour()]) {
      expect(markup).toContain(`src="${poster}"`);
      expect(markup).toContain('class="guide-film-still"');
      expect(markup).toContain("Play this step");
      expect(markup).not.toContain("is-revealed");
    }
  });

  it("keeps the normal autoplay path and independently supports manual playback", () => {
    mockReducedMotion(false);
    expect(renderPage()).not.toContain("Play this step");
    expect(renderTour()).not.toContain("Play this step");
    const manual = renderToStaticMarkup(createElement(GuideFilm, {
      view: "day",
      film: GUIDE_FILMS.day[0]!,
      chapterKey: "day:0",
      autoplay: false,
      onEnded: () => undefined,
    }));
    expect(manual).toContain("Play this step");
  });

  it("gates both autoplay and automatic chapter handoff under reduced motion", () => {
    expect(guideMayAutoplay(true, true)).toBe(false);
    expect(guideMayAutoplay(false, false)).toBe(false);
    expect(guideMayAutoplay(true, false)).toBe(true);
    let chapter = 0;
    for (const reduced of [true, false, false, false]) {
      if (guideMayAutoplay(true, reduced)) chapter = nextGuideChapter(chapter, 3);
    }
    expect(chapter).toBe(2);
    expect(nextGuideChapter(chapter, 3)).toBe(2);
    expect(nextGuideChapter(0, 0)).toBe(0);
  });

  it("subscribes to OS preference changes and cleans up the listener", () => {
    const query = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("window", { matchMedia: () => query });
    expect(prefersReducedGuideMotion()).toBe(false);
    const listener = vi.fn();
    const unsubscribe = subscribeToGuideMotion(listener);
    expect(query.addEventListener).toHaveBeenCalledWith("change", listener);
    query.matches = true;
    expect(prefersReducedGuideMotion()).toBe(true);
    unsubscribe();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", listener);
  });
});

describe("workspace tour chapter and page navigation", () => {
  it("renders all five page choices and starts on the first page and chapter", () => {
    const markup = renderTour();
    expect(TOUR_PAGES).toEqual(["day", "tasks", "review", "insights", "settings"]);
    expect(markup).toContain('aria-label="Pages in this tour"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain('data-chapter="day:0"');
    expect(markup).toContain("Next: Tasks");
    expect((markup.match(/class="guide-step-control"/g) ?? []).length).toBe(3);
  });

  it("resets chapter on forward and backward page jumps without allowing invalid pages", () => {
    const day = { page: 0, chapter: 2 };
    expect(navigateTour(day, 0)).toBe(day);
    const tasks = navigateTour(day, 1);
    expect(tasks).toEqual({ page: 1, chapter: 0 });
    expect(GUIDE_FILMS[TOUR_PAGES[tasks.page]!][tasks.chapter]!.poster).toBe(GUIDE_FILMS.tasks[0]!.poster);
    const last = navigateTour(tasks, 4);
    expect(last).toEqual({ page: 4, chapter: 0 });
    expect(navigateTour(last, 1)).toEqual({ page: 1, chapter: 0 });
    for (const invalid of [-1, 5, 1.5, NaN]) expect(navigateTour(last, invalid)).toBe(last);
  });
});
