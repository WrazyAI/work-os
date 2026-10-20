import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");
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

  it("makes the step body the one child that grows, shrinks, and scrolls", () => {
    expect(contentRule).toMatch(/flex:\s*1 1 auto;/);
    // Without this a flex child refuses to shrink below its content, so a tall
    // step would still push the footer out instead of scrolling.
    expect(contentRule).toMatch(/min-height:\s*0;/);
    // The overflow declaration itself stays in styles.css, where the narrow
    // layout flips it to `visible`; this file must not pin it back to `auto`.
    expect(contentRule).not.toMatch(/overflow:\s*auto;/);
  });
});
