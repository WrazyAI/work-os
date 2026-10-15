import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

describe("page guide interaction styles", () => {
  it("keeps every dismissal/control target at least 40px", () => {
    expect(styles).toMatch(/\.task-modal\.guide-modal > header button \{[\s\S]*?min-width:\s*40px;[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.task-modal\.guide-modal > footer \.primary \{[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.guide-quiet-action \{[\s\S]*?min-height:\s*40px;/);
    expect(styles).toMatch(/\.guide-step-control \{[\s\S]*?min-height:\s*40px;/);
  });

  it("keeps the film's grid row from being squeezed into the step list", () => {
    // The body is a definite-height scroll region and the film is the only row
    // in it whose item clips, so its row was the one track an `auto` grid would
    // shrink whenever the modal's max-height could not hold the whole guide —
    // and the 2:1 frame then overflowed its own row, painting over the first
    // step's tinted background. `max-content` rows cannot be squeezed: the
    // frame keeps its height, the 16px above the step list holds, and the
    // guide scrolls its body instead (§8.11).
    expect(styles).toMatch(/\.task-modal\.guide-modal > \.task-modal-body\.guide-modal-body \{[\s\S]*?gap:\s*16px;[\s\S]*?grid-auto-rows:\s*max-content;/);
  });

  it("keeps the film frame wide, layered, and still under reduced motion", () => {
    // The frame is the guide's illustration: the still guarantees a first paint
    // and the clip sits over it, so a slow decode shows the page rather than a
    // hole. Reduced motion must not animate either of them.
    expect(styles).toMatch(/\.guide-film \{[\s\S]*?aspect-ratio:\s*2 \/ 1;/);
    expect(styles).toMatch(/\.guide-film-video \{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
    expect(styles).toMatch(/\.guide-film-progress > span \{[\s\S]*?transform:\s*scaleX\(0\);/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.guide-film-video \{[\s\S]*?transition:\s*none;/);
    expect(styles).toMatch(/\.guide-step-control \{[\s\S]*?min-height:\s*40px;/);
  });
});
