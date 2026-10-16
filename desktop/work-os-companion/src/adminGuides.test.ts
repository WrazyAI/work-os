import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_GUIDE_VIEWS } from "./guideState";

const workspace = readFileSync(new URL("./admin/AdminWorkspace.tsx", import.meta.url), "utf8");
const adminStyles = readFileSync(new URL("./admin/admin.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

/**
 * The administration workspace's page guide is the employee one: same modal,
 * same state seam, same masthead contract. These read the sources because the
 * contract is about wiring that a page-level render test cannot see.
 */
describe("administration page guides", () => {
  it("mount one masthead control named for the page, reusing the employee contract", () => {
    expect(workspace).toContain('className="icon guide-launch"');
    expect(workspace).toContain("aria-label={`How ${meta.title} works`}");
    expect(workspace).toContain("onClick={() => onOpenGuide(guideView)}");
    // The control only exists for an administrator and only while the guide
    // seam has something to open.
    expect(workspace).toContain('session.role === "admin" && guideView && onOpenGuide');
  });

  it("never keeps a second copy of the guide state inside the workspace", () => {
    expect(workspace).not.toContain("usePageGuides");
    // The app owns the one hook; the workspace only receives what it renders.
    expect((app.match(/usePageGuides\(/g) ?? []).length).toBe(1);
    expect(app).toContain("guideView={pageGuideView}");
    expect(app).toContain("onOpenGuide={openGuide}");
  });

  it("keys the admin section into the guide state and walks it with the admin tour", () => {
    expect(app).toContain("guideViewForAdminSection(adminSection)");
    expect(app).toContain("pages={ADMIN_TOUR_PAGES}");
    expect(app).toContain('tourScope === "admin" && adminWorkspaceBranch');
    // The tour drives the real workspace and lands on each section.
    expect(app).toContain("navigateAdminGuide");
  });

  it("films the administration sections like the employee pages", () => {
    // Every administration guide carries one clip per step, shot through the
    // admin-shell fixtures boot, and the drawn scene vocabulary is gone.
    expect(adminStyles).not.toContain(".guide-art");
    expect(adminStyles).not.toContain(".guide-phase");
    const films = readFileSync(new URL("./guideFilms.ts", import.meta.url), "utf8");
    for (const view of ADMIN_GUIDE_VIEWS) expect(films).toContain(`  ${view}: [`);
  });
});
