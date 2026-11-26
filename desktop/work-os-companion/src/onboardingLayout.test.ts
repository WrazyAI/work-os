import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readBaseStyles } from "./styles/readStyles";

const styles = readBaseStyles();
const formStyles = readFileSync(fileURLToPath(new URL("./onboarding-form.css", import.meta.url)), "utf8");

/** The setup panel's column: masthead, optional scenario banner, scrolling
 *  step body, pinned actions.
 *
 *  The banner only renders in the debugger. While the column used a positional
 *  grid row template, its absence shifted every later child up one row: the
 *  step body took `auto` (so it grew instead of scrolling) and the footer took
 *  the flexible row. A step taller than the window then pushed the footer past
 *  the panel's `overflow: hidden`, so Back/Saved/Continue disappeared — which
 *  is what a production employee saw while the debugger looked correct. */
describe("setup panel column", () => {
  const shellRule = styles.match(/\.guided-onboarding \{[\s\S]*?\n\}/)?.[0] ?? "";
  const workspaceRule = styles.match(/\.onboarding-workspace \{[\s\S]*?\n\}/)?.[0] ?? "";
  const headerRule = formStyles.match(/\.onboarding-workspace > header \{[\s\S]*?\n\}/)?.[0] ?? "";
  const scrollRule = styles.match(/\.phase-scroll \{[\s\S]*?\n\}/)?.[0] ?? "";
  const contentRule = formStyles.match(/\.phase-content \{[\s\S]*?\n\}/)?.[0] ?? "";
  const actionsRule = formStyles.match(/\.phase-actions \{[\s\S]*?\n\}/)?.[0] ?? "";

  it("fits the real webview even below the preferred native window height", () => {
    expect(shellRule).toMatch(/height:\s*100vh;/);
    expect(shellRule).toMatch(/min-height:\s*0;/);
  });

  it("stacks the panel with flex, so an optional child cannot shift the rest", () => {
    expect(workspaceRule).toContain("display: flex");
    expect(workspaceRule).toContain("flex-direction: column");
    // A positional row template is what broke the production layout.
    expect(workspaceRule).not.toContain("grid-template-rows");
  });

  it("keeps the masthead and the actions at their own height", () => {
    expect(headerRule).toMatch(/flex:\s*0 0 68px;/);
    expect(actionsRule).toMatch(/flex:\s*0 0 auto;/);
  });

  it("makes the scroll region the one child that grows, shrinks, and scrolls", () => {
    expect(scrollRule).toMatch(/flex:\s*1 1 auto;/);
    // Without this a flex child refuses to shrink below its content, so a tall
    // step would still push the footer out instead of scrolling.
    expect(scrollRule).toMatch(/min-height:\s*0;/);
    expect(scrollRule).toMatch(/overflow-y:\s*auto;/);
    // The scrolling element spans the panel, so its scrollbar sits at the
    // window edge. The measured form column inside it must not scroll again.
    expect(scrollRule).toMatch(/width:\s*100%;/);
    expect(contentRule).not.toMatch(/overflow:\s*auto;/);
    expect(contentRule).toMatch(/min-height:\s*100%;/);
  });

  it("keeps the scrollbar at the panel edge while the form column stays inset", () => {
    // A centred, narrower scroller put the scrollbar 28px inside the window and
    // left a dead strip beside it. The region now owns the full edge; only the
    // content column below it keeps the measured width and auto margins.
    expect(scrollRule).not.toMatch(/margin:\s*0 auto;/);
    expect(contentRule).toMatch(/margin:\s*0 auto;/);
    expect(contentRule).toMatch(/width:\s*min\(680px, calc\(100% - 56px\)\);/);
  });

  it("anchors narrow actions to the viewport and reserves their content clearance", () => {
    const narrowStyles = styles.slice(styles.indexOf('@media (max-width: 720px)', styles.indexOf(".guided-onboarding {")));
    const footer = narrowStyles.match(/\.phase-actions \{[\s\S]*?\n  \}/)?.[0] ?? "";
    const workspace = narrowStyles.match(/\.onboarding-workspace \{[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(footer).toMatch(/position:\s*fixed;/);
    expect(footer).toMatch(/bottom:\s*0;/);
    expect(workspace).toContain("padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px))");
  });

  it("does not let a filled container transform capture the narrow fixed actions", () => {
    const narrowFormStyles = formStyles.slice(formStyles.indexOf('@media (max-width: 720px)'));
    const workspace = narrowFormStyles.match(/\.guided-onboarding\[data-stage="form"\] \.onboarding-workspace \{[\s\S]*?\n  \}/)?.[0] ?? "";
    expect(workspace).toMatch(/animation:\s*none;/);
  });
});
