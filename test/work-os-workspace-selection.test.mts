import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isWorkOsOrganizationId,
  safeWorkOsWorkspaceNext,
  WORK_OS_WORKSPACE_COOKIE,
  WORK_OS_WORKSPACE_HOME,
} from "../src/modules/work-os/workspace";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

async function workspaceChooser() {
  const module = await import("../src/modules/work-os/WorkspaceChooser");
  return ((module.default as unknown as { default?: unknown }).default ?? module.default) as never;
}

test("the workspace cookie carries only a UUID", () => {
  assert.equal(WORK_OS_WORKSPACE_COOKIE, "work-os-org");
  assert.equal(isWorkOsOrganizationId("b094c847-1332-4cab-9588-bdd7f8e99e7d"), true);
  assert.equal(isWorkOsOrganizationId("David Yeboah Workspace"), false);
  assert.equal(isWorkOsOrganizationId("../work-os"), false);
  assert.equal(isWorkOsOrganizationId(null), false);
});

test("post-selection destinations stay inside Work OS", () => {
  assert.equal(safeWorkOsWorkspaceNext("/work-os"), WORK_OS_WORKSPACE_HOME);
  assert.equal(safeWorkOsWorkspaceNext("/work-os/tasks?view=unfinished"), "/work-os/tasks?view=unfinished");
  assert.equal(safeWorkOsWorkspaceNext("/work-os/admin/people"), "/work-os/admin/people");
  assert.equal(safeWorkOsWorkspaceNext("/work-os/select-workspace"), WORK_OS_WORKSPACE_HOME);
  assert.equal(safeWorkOsWorkspaceNext("https://evil.example/work-os"), WORK_OS_WORKSPACE_HOME);
  assert.equal(safeWorkOsWorkspaceNext("//evil.example/work-os"), WORK_OS_WORKSPACE_HOME);
  assert.equal(safeWorkOsWorkspaceNext("/work-os-preview"), WORK_OS_WORKSPACE_HOME);
  assert.equal(safeWorkOsWorkspaceNext("\\work-os"), WORK_OS_WORKSPACE_HOME);
});

test("the chooser names every workspace and posts the chosen id", async () => {
  const Chooser = await workspaceChooser();
  const html = renderToStaticMarkup(createElement(Chooser, {
    currentOrganizationId: "org-1",
    workspaces: [
      { organizationId: "org-1", name: "David Yeboah Workspace", role: "admin", personId: "p-1" },
      { organizationId: "org-2", name: "WrazyAI Owner Workspace", role: "employee", personId: "p-2" },
    ],
  }));

  assert.match(html, /Choose a workspace/);
  assert.match(html, /David Yeboah Workspace/);
  assert.match(html, /WrazyAI Owner Workspace/);
  assert.match(html, /Admin workspace/);
  assert.match(html, /Employee workspace/);
  assert.match(html, /Current/);
  assert.match(html, /name="organization_id" value="org-1"/);
  assert.match(html, /name="organization_id" value="org-2"/);
  assert.match(html, /action="\/api\/work-os\/session\/workspace"/);
  assert.match(html, /aria-label="Open WrazyAI Owner Workspace"/);
});

test("a forbidden choice is stated inline, not as a silent fallback", async () => {
  const Chooser = await workspaceChooser();
  const html = renderToStaticMarkup(createElement(Chooser, {
    error: "That workspace is not available to this account. Choose another one.",
    workspaces: [{ organizationId: "org-1", name: "David Yeboah Workspace", role: "admin", personId: null }],
  }));
  assert.match(html, /role="alert"/);
  assert.match(html, /not available to this account/);
});

test("the web session asks for a choice instead of choosing a workspace", () => {
  const route = source("src/app/api/work-os/session/route.ts");
  assert.match(route, /resolveWorkOsSession/);
  assert.match(route, /requiresWorkspaceSelection: true/);
  assert.match(route, /organizationName: access\.organizationName/);
  assert.match(route, /organizations: access\.workspaces/);
});

test("the switch route verifies membership before writing the cookie", () => {
  const route = source("src/app/api/work-os/session/workspace/route.ts");
  assert.match(route, /getCurrentProfile/);
  assert.match(route, /listWorkOsWorkspaces/);
  assert.match(route, /workspaces\.find/);
  assert.match(route, /workspace is not available to this account/);
  assert.match(route, /name: WORK_OS_WORKSPACE_COOKIE/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /sameSite: "lax"/);
  assert.match(route, /status: 303/);
  assert.match(route, /safeWorkOsWorkspaceNext/);
});

test("server pages redirect a multi-workspace account to the chooser", () => {
  const access = source("src/lib/work-os-page-access.ts");
  assert.match(access, /resolveWorkOsSession/);
  assert.match(access, /redirect\(WORK_OS_WORKSPACE_SELECT\)/);
  const page = source("src/app/work-os/select-workspace/page.tsx");
  assert.match(page, /WorkspaceChooser/);
  assert.match(page, /listWorkOsWorkspaces/);
  assert.match(page, /readWorkOsOrganizationCookie/);
});

test("the desktop connect screen sends the chosen workspace with authorization", () => {
  const connect = source("src/app/work-os/desktop/connect/DesktopConnect.tsx");
  assert.match(connect, /workspaces: WorkOsWorkspaceChoice\[\]/);
  assert.match(connect, /organization_id: selected\.organizationId/);
  assert.match(connect, /No Work OS workspace has a workday mapped/);
  const route = source("src/app/api/work-os/desktop/authorize/route.ts");
  assert.match(route, /body\.organization_id/);
  assert.match(route, /organizationId,/);
});

async function desktopConnectView() {
  const module = await import("../src/app/work-os/desktop/connect/DesktopConnect");
  return module.DesktopConnectView as unknown as (props: Record<string, unknown>) => unknown;
}

function renderDesktopConnect(view: unknown, props: Record<string, unknown>) {
  return renderToStaticMarkup(createElement(view as never, props as never));
}

test("the desktop connect screen has a visible approved state", async () => {
  const DesktopConnectView = await desktopConnectView();
  const base = {
    accountLabel: "David Yeobah",
    workspaces: [{ organizationId: "b094c847-1332-4cab-9588-bdd7f8e99e7d", name: "David Yeobah Workspace", role: "employee", personId: "person-1" }],
    organizationId: "b094c847-1332-4cab-9588-bdd7f8e99e7d",
    authorizedOrganizationId: "b094c847-1332-4cab-9588-bdd7f8e99e7d",
    onOrganizationChange: () => undefined,
    requestValid: true,
    requestPresent: true,
    error: "",
    onApprove: () => undefined,
    onOpenCompanion: () => undefined,
    onStartOver: () => undefined,
    onReturnToWorkOs: () => undefined,
  };
  const idle = renderDesktopConnect(DesktopConnectView, { ...base, status: "idle", callbackUrl: null });
  assert.match(idle, /Authorize this device/);
  assert.match(idle, /Signed in as/);
  assert.match(idle, /Authorize device/);
  assert.match(idle, /Waiting for approval/);

  const approved = renderDesktopConnect(DesktopConnectView, { ...base, status: "authorized", callbackUrl: "wrazy-workos://auth?code=code&state=state" });
  assert.match(approved, /Device authorized/);
  assert.match(approved, /Open Work OS/);
  assert.match(approved, /Return to Work OS/);
  assert.doesNotMatch(approved, /Close this tab/);
  assert.match(approved, /five minutes/);
  assert.doesNotMatch(approved, /Authorize device/);

  const failed = renderDesktopConnect(DesktopConnectView, { ...base, status: "error", callbackUrl: null, error: "Could not authorize this device." });
  assert.match(failed, /Could not authorize this device/);
  assert.match(failed, /Try again/);
});

test("workspace choice is locked while device authorization is pending", async () => {
  const DesktopConnectView = await desktopConnectView();
  const workspaces = [
    { organizationId: "org-a", name: "North Team", role: "employee", personId: "person-a" },
    { organizationId: "org-b", name: "South Team", role: "employee", personId: "person-b" },
  ];
  const html = renderDesktopConnect(DesktopConnectView, {
    accountLabel: "David Yeboah",
    workspaces,
    organizationId: "org-a",
    onOrganizationChange: () => undefined,
    requestValid: true,
    requestPresent: true,
    status: "working",
    error: "",
    callbackUrl: null,
    onApprove: () => undefined,
    onOpenCompanion: () => undefined,
    onStartOver: () => undefined,
    onReturnToWorkOs: () => undefined,
  });

  assert.match(html, /<select[^>]*disabled=""/);
});

test("approved receipt keeps the workspace used for authorization", async () => {
  const DesktopConnectView = await desktopConnectView();
  const workspaces = [
    { organizationId: "org-a", name: "North Team", role: "employee", personId: "person-a" },
    { organizationId: "org-b", name: "South Team", role: "employee", personId: "person-b" },
  ];
  const html = renderDesktopConnect(DesktopConnectView, {
    accountLabel: "David Yeboah",
    workspaces,
    organizationId: "org-b",
    authorizedOrganizationId: "org-a",
    onOrganizationChange: () => undefined,
    requestValid: true,
    requestPresent: true,
    status: "authorized",
    error: "",
    callbackUrl: "wrazy-workos://auth?code=code&state=state",
    onApprove: () => undefined,
    onOpenCompanion: () => undefined,
    onStartOver: () => undefined,
    onReturnToWorkOs: () => undefined,
  });

  assert.match(html, /North Team/);
  assert.doesNotMatch(html, /South Team/);
});

test("authorization passes its submitted workspace to the approved receipt", () => {
  const connect = source("src/app/work-os/desktop/connect/DesktopConnect.tsx");
  assert.match(connect, /setAuthorizedOrganizationId\(selected\.organizationId\)/);
  assert.match(connect, /authorizedOrganizationId=\{authorizedOrganizationId\}/);
  assert.match(connect, /organization_id:\s*selected\.organizationId/);
});

test("the approved screen attempts the companion handoff automatically, once", () => {
  const connect = source("src/app/work-os/desktop/connect/DesktopConnect.tsx");
  const approve = connect.slice(connect.indexOf("async function approve"), connect.indexOf("const openCompanion"));
  assert.doesNotMatch(approve, /window\.location\.assign/);
  assert.match(connect, /const companionHandoffAttempted = useRef\(false\)/);
  assert.match(connect, /useEffect\(\(\) => \{[\s\S]{0,240}companionHandoffAttempted\.current = true;[\s\S]{0,80}openCompanion\(\);/);
  assert.match(connect, /startOver[\s\S]{0,200}companionHandoffAttempted\.current = false;/);
  const openCompanionStart = connect.indexOf("const openCompanion");
  const openCompanion = connect.slice(openCompanionStart, connect.indexOf("useEffect(", openCompanionStart));
  assert.match(openCompanion, /window\.location\.assign\(callbackUrl\)/);
  assert.match(connect, /function returnToWorkOs[\s\S]*window\.location\.assign\("\/work-os"\)/);
  assert.doesNotMatch(connect, /window\.close\(\)/);
  assert.match(connect, /onClick=\{onOpenCompanion\}/);
});

test("both shells show the active workspace and a switch when one exists", () => {
  const admin = source("src/modules/work-os/admin/AdminShell.tsx");
  assert.match(admin, /sessionData\.organizationName/);
  assert.match(admin, /Switch workspace/);
  assert.match(admin, /organizationId.*select-workspace|select-workspace/);

  const employee = source("src/modules/work-os/employee/EmployeeWorkspaceShell.tsx");
  assert.match(employee, /organizationName/);
  assert.match(employee, /Switch workspace/);
  assert.match(employee, /canSwitchWorkspaces/);
});
