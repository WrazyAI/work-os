import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_OVERVIEW_STALE_AFTER_MS,
  adminRoleLabel,
  niftySyncReceipt,
  overviewStaleMessage,
  workspaceDegradedNotice,
} from "./adminNotifications";

describe("administration notifications", () => {
  it("reports a stale overview snapshot with its own generation time", () => {
    const now = Date.parse("2026-10-15T12:00:00.000Z");
    expect(overviewStaleMessage("2026-10-15T11:00:00.000Z", now)).toBe("This snapshot was generated 1h ago and may not reflect the current record.");
    expect(overviewStaleMessage(new Date(now - ADMIN_OVERVIEW_STALE_AFTER_MS + 1_000).toISOString(), now)).toBeNull();
    expect(overviewStaleMessage(null, now)).toBeNull();
    expect(overviewStaleMessage("not-a-date", now)).toBeNull();
    // Clock skew never reads as staleness.
    expect(overviewStaleMessage("2026-10-15T12:05:00.000Z", now)).toBeNull();
  });

  it("names only the degraded states the status endpoint reports", () => {
    expect(workspaceDegradedNotice({ schema: { ready: false, migration: "0021" }, nifty: { canCallApi: true, hasRefreshToken: true } })?.title).toBe("Work OS schema is not ready");
    expect(workspaceDegradedNotice({ schema: { ready: true, migration: "0021" }, nifty: { canCallApi: false, hasRefreshToken: false } })?.title).toBe("Nifty needs a connection");
    expect(workspaceDegradedNotice({ schema: { ready: true, migration: "0021" }, nifty: { canCallApi: true, hasRefreshToken: true } })).toBeNull();
    expect(workspaceDegradedNotice(undefined)).toBeNull();
    // The schema caveat comes first: a missing migration is the blocking state.
    expect(workspaceDegradedNotice({ schema: { ready: false, migration: "0021" }, nifty: { canCallApi: false, hasRefreshToken: false } })?.title).toBe("Work OS schema is not ready");
  });

  it("repeats the Nifty sync's own counts and never invents them", () => {
    expect(niftySyncReceipt({ nifty: { tasks: 12, projects: 3, members: 8, syncedAt: "2026-10-15T12:00:00.000Z" } }))
      .toBe("The sync read 12 tasks, 3 projects, and 8 members from Nifty and refreshed the mirror.");
    expect(niftySyncReceipt({ nifty: { tasks: 1, projects: 0, members: 0 } }))
      .toBe("The sync read 1 task from Nifty and refreshed the mirror.");
    expect(niftySyncReceipt({ nifty: { tasks: 0, projects: 0, members: 0 } }))
      .toBe("Nifty returned no tasks, projects, or members to mirror.");
    expect(niftySyncReceipt({ nifty: { syncedAt: "2026-10-15T12:00:00.000Z" } }))
      .toBe("The task record finished syncing with Nifty.");
    expect(niftySyncReceipt(undefined)).toBe("The task record finished syncing with Nifty.");
  });

  it("uses the role names the workspace's own selects show", () => {
    expect(adminRoleLabel("admin")).toBe("Administrator");
    expect(adminRoleLabel("manager")).toBe("Manager");
    expect(adminRoleLabel("employee")).toBe("Employee");
    expect(adminRoleLabel("")).toBe("member");
  });

  it("runs every administration receipt through the shared notification provider", () => {
    for (const page of ["OverviewPage.tsx", "TasksPage.tsx", "ReviewPage.tsx", "EvidencePage.tsx", "SettingsPage.tsx"]) {
      const source = readFileSync(new URL(`./${page}`, import.meta.url), "utf8");
      expect(source).toContain('from "../NotificationFlyouts"');
      expect(source).toContain("useNotifications()");
    }
  });

  it("starts the admin flyout stack below the masthead switch", () => {
    const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");
    // The stack is fixed to the viewport's top-right, which the admin masthead's
    // workspace switch also occupies; the admin-scoped rule must move it down.
    expect(css).toContain(".admin-workspace ~ .notification-flyouts");
    expect(css).toContain("top: max(118px");
  });

  it("keeps the open notifications panel above the admin receipt stack", () => {
    const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");
    // The bell's panel is portaled to the document body, so the admin scope is
    // reached through :has rather than the sibling selector the stack uses.
    expect(css).toContain("body:has(.admin-workspace) .notifications-card");
    expect(css).toContain("z-index: 5100");
  });
});
