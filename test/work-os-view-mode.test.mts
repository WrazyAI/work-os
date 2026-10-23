// The web view switch: administrators move between Administration and My
// workspace without changing their role or losing the route guard. These tests
// pin the pure decision rules and the gates that enforce them.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  effectiveWorkOsViewMode,
  parseWorkOsViewMode,
  safeWorkOsViewNext,
  workOsViewSelectionLocation,
  WORK_OS_VIEW_COOKIE,
} from "../src/modules/work-os/view-mode";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("a missing or unknown preference keeps administrators in Administration", () => {
  assert.equal(WORK_OS_VIEW_COOKIE, "work-os-view");
  assert.equal(parseWorkOsViewMode(undefined), "admin");
  assert.equal(parseWorkOsViewMode("admin"), "admin");
  assert.equal(parseWorkOsViewMode("something-else"), "admin");
  assert.equal(parseWorkOsViewMode("employee"), "employee");
});

test("only a mapped administrator can enter My workspace", () => {
  assert.equal(effectiveWorkOsViewMode({ role: "employee", personId: "p-1" }, "admin"), "employee");
  assert.equal(effectiveWorkOsViewMode({ role: "manager", personId: "p-1" }, "admin"), "employee");
  assert.equal(effectiveWorkOsViewMode({ role: "admin", personId: null }, "employee"), "admin");
  assert.equal(effectiveWorkOsViewMode({ role: "admin", personId: "p-1" }, "employee"), "employee");
  assert.equal(effectiveWorkOsViewMode({ role: "admin", personId: "p-1" }, undefined), "admin");
});

test("a switch that needs a workspace choice keeps the chosen view and destination", () => {
  assert.equal(
    workOsViewSelectionLocation("admin", "/work-os/admin/people"),
    "/work-os/select-workspace?next=%2Fwork-os%2Fadmin%2Fpeople",
  );
  assert.equal(
    workOsViewSelectionLocation("employee", "/work-os/tasks"),
    "/work-os/select-workspace?next=%2Fwork-os%2Ftasks",
  );
  assert.equal(
    workOsViewSelectionLocation("admin", "https://evil.example/work-os/admin"),
    "/work-os/select-workspace?next=%2Fwork-os%2Fadmin",
  );
  assert.equal(
    workOsViewSelectionLocation("employee", "/work-os/admin"),
    "/work-os/select-workspace?next=%2Fwork-os%2Ftoday",
  );
});

test("the switch stores the preference before asking for a workspace", () => {
  const route = source("src/app/api/work-os/view-mode/route.ts");
  const selection = route.slice(
    route.indexOf("x-work-os-workspace-selection"),
    route.indexOf('return redirectTo("/login")'),
  );
  assert.match(selection, /workOsViewSelectionLocation/);
  assert.match(selection, /cookies\.set/);
});

test("switch destinations cannot escape the view being entered", () => {
  assert.equal(safeWorkOsViewNext("employee", "/work-os/tasks"), "/work-os/tasks");
  assert.equal(safeWorkOsViewNext("employee", "/work-os/review?tab=evidence"), "/work-os/review?tab=evidence");
  assert.equal(safeWorkOsViewNext("employee", "/work-os"), "/work-os");
  assert.equal(safeWorkOsViewNext("employee", "/work-os/admin/people"), "/work-os/today");
  assert.equal(safeWorkOsViewNext("employee", "https://evil.example/work-os/today"), "/work-os/today");
  assert.equal(safeWorkOsViewNext("employee", "//evil.example/work-os/today"), "/work-os/today");
  assert.equal(safeWorkOsViewNext("employee", "/work-os-preview"), "/work-os/today");
  assert.equal(safeWorkOsViewNext("admin", "/work-os/admin/people"), "/work-os/admin/people");
  assert.equal(safeWorkOsViewNext("admin", "/work-os/admin"), "/work-os/admin");
  assert.equal(safeWorkOsViewNext("admin", "/work-os/today"), "/work-os/admin");
  assert.equal(safeWorkOsViewNext("admin", "https://evil.example/work-os/admin"), "/work-os/admin");
});

test("the session reports the effective view for the shell", () => {
  const session = source("src/app/api/work-os/session/route.ts");
  assert.match(session, /viewMode: await resolveWorkOsViewModeFor\(access\)/);
  const contract = source("src/modules/work-os/session.ts");
  assert.match(contract, /viewMode: WorkOsViewMode/);
});

test("employee and administration routes gate on the active view", () => {
  const employeeLayout = source("src/app/work-os/(employee)/layout.tsx");
  assert.match(employeeLayout, /resolveWorkOsViewModeFor\(resolved\.access\)/);
  assert.match(employeeLayout, /viewMode !== "employee"\) redirect\("\/work-os\/admin"\)/);

  const adminLayout = source("src/app/work-os/admin/layout.tsx");
  assert.match(adminLayout, /resolveWorkOsViewModeFor\(resolved\.access\) === "employee"\) redirect\("\/work-os\/today"\)/);

  const dispatcher = source("src/app/work-os/page.tsx");
  assert.match(dispatcher, /const viewMode = await resolveWorkOsViewModeFor\(resolved\.access\)/);
  assert.match(dispatcher, /if \(viewMode === "employee"\) redirect\(employeeDestinationForLegacyTab\(tab\)\)/);
});

test("the switch is a POST that stores a per-device preference, not a role change", () => {
  const route = source("src/app/api/work-os/view-mode/route.ts");
  assert.match(route, /requireWorkOsAccess/);
  assert.match(route, /auth\.access\.role !== "admin"/);
  assert.match(route, /requested === "employee" && !auth\.access\.personId/);
  assert.match(route, /safeWorkOsViewNext\(requested, form\.get\(WORK_OS_VIEW_NEXT_FIELD\)\)/);
  assert.match(route, /name: WORK_OS_VIEW_COOKIE/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /sameSite: "lax"/);
  assert.match(route, /status: 303/);
});

test("the console gate only enters My workspace for a mapped administrator", () => {
  const lib = source("src/lib/work-os-view-mode.ts");
  const api = source("src/lib/work-os-api.ts");
  assert.match(lib, /resolveWorkOsConsoleViewMode/);
  assert.match(lib, /preference !== "employee"\) return "admin"/);
  assert.match(lib, /hasMappedWorkOsAdminMembership\(userId\)/);
  assert.match(api, /export async function hasMappedWorkOsAdminMembership/);
  assert.match(api, /membership\.role === "admin" && membership\.person_id/);
  const route = source("src/app/api/work-os/view-mode/route.ts");
  assert.doesNotMatch(route, /ensureAdminPersonRecord|from\("work_people"\)/);
  assert.doesNotMatch(lib, /ensureAdminPersonRecord|createAdminClient/);
});

test("the dispatcher fallback follows the administrator's active view", () => {
  const home = source("src/modules/work-os/WorkOsHome.tsx");
  assert.match(home, /data\?\.role === "admin" && data\.viewMode === "employee"/);
  assert.match(home, /"Open My workspace"/);
  assert.match(home, /"Open Work OS administration"/);
});

test("both workspaces expose the switch and the employee frame owns the band", () => {
  const employeeShell = source("src/modules/work-os/employee/EmployeeWorkspaceShell.tsx");
  assert.match(employeeShell, /WorkOsViewModeForm/);
  assert.match(employeeShell, /Switch to Administration/);
  assert.match(employeeShell, /next="\/work-os\/admin"/);

  const adminShell = source("src/modules/work-os/admin/AdminShell.tsx");
  assert.match(adminShell, /WorkOsViewModeForm/);
  assert.match(adminShell, /Switch to my workspace/);
  assert.match(adminShell, /next="\/work-os\/today"/);
  assert.match(adminShell, /No personal workday is mapped to this account/);
});
