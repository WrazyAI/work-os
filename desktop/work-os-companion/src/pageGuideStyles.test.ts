import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

describe("page guide interaction styles", () => {
  it("keeps every dismissal/control target at least 40px", () => {
    expect(styles).toMatch(/\.task-modal\.guide-modal > header\.guide-head button \{[\s\S]*?min-width:\s*40px;[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.task-modal\.guide-modal > footer\.guide-modal-footer \.primary \{[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.guide-quiet-action \{[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.guide-step-control \{[\s\S]*?min-height:\s*44px;/);
  });

  it("is a split view by default and returns to one column when narrow", () => {
    // The film plate is the left column and the script runs beside it. The
    // narrow layout is a real switch, not a squeeze: the header comes first and
    // the plate returns to the top of a single column.
    expect(styles).toMatch(/\.task-modal\.guide-modal \{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.24fr\)\s*minmax\(330px,\s*0\.86fr\);/);
    expect(styles).toMatch(/"screen head"\s*"screen steps"\s*"screen foot"/);
    expect(styles).toMatch(/@media \(max-width: 880px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?"head"\s*"screen"\s*"rail"/);
    // The plate is the only full-height column; the script's rows own the
    // actions, so a short window scrolls the chapters rather than the modal.
    expect(styles).toMatch(/\.guide-steps \{[\s\S]*?overflow-y:\s*auto;/);
  });

  it("keeps the film frame wide, layered, and still under reduced motion", () => {
    // The frame is the guide's illustration: the still guarantees a first paint
    // and the clip sits over it, so a slow decode shows the page rather than a
    // hole. Reduced motion must not animate either of them.
    expect(styles).toMatch(/\.guide-film \{[\s\S]*?aspect-ratio:\s*2 \/ 1;/);
    expect(styles).toMatch(/\.guide-film-video \{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
    expect(styles).toMatch(/\.guide-film-progress > span \{[\s\S]*?transform:\s*scaleX\(0\);/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.guide-screen-plate \{[\s\S]*?animation:\s*none;/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.guide-step-control,?[\s\S]*?transition:\s*none;/);
  });

  it("keeps the reduced-motion play control clickable over the frame", () => {
    // The still and clip cover the frame; the transport is the one target.
    // Without this, the video owns the pointer and the only way to start a
    // chapter under reduced motion is unreachable.
    expect(styles).toMatch(/\.guide-film \{[\s\S]*?pointer-events:\s*none;/);
    expect(styles).toMatch(/\.guide-film-play \{[\s\S]*?pointer-events:\s*auto;/);
    expect(styles).toMatch(/\.guide-film-still,\s*\n\.guide-film-video \{[\s\S]*?pointer-events:\s*none;/);
  });
});
