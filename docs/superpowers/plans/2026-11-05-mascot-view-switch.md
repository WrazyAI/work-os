# Floating Otto Employee / Administration View Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators switch the floating companion and the application between Employee and Administration views from one mascot control, with the matching conversation in each view and an Otto costume change.

**Architecture:** Main owns the selected workspace and publishes one sanitized view snapshot; the floating window adopts it and sends scoped switch requests back. The floating Administration view reuses the existing `AdminOttoChat` engine through a new floating presentation variant. The mascot renderer gains a mode-driven blazer and spectacles layer, with a one-shot transition owned by `MascotPet` and disabled under reduced motion.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Tauri v2 event bus, CSS/SVG, Playwright rendered checks.

**Spec:** `docs/superpowers/specs/2026-11-05-mascot-view-switch-design.md`

## Global Constraints

- Do not add a Tauri command or ACL permission; use the existing webview event bus.
- Main is the only source of truth for the selected workspace; the floating window never sets its mode optimistically.
- Administration chat keeps the existing admin authorization, preview/confirm, provenance, and New chat rules. No employee mutation path is introduced.
- Mascot identity and renderers stay behind `MASCOT` in `src/mascot.ts`; no surface hardcodes mascot art.
- All view, conversation, and record events carry only scope, epoch, mode, opaque ids, and capability booleans. Never send conversation text, tokens, records, or provider data.
- The costume transition is one-shot, never loops, and renders its final state under `prefers-reduced-motion: reduce`.
- Use the native WSL Node toolchain: `export PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH`.
- Do not run `npm install` while a dev or production server is running.
- The companion queue is append-only. This outcome is expected to be the fifth pending update; re-check `npm run companion:release:status` before bumping any version.
- Run CodeRabbit once per completed task batch, not per commit.

## Review Focus

- An Administration workspace whose admin context failed must not silently render Employee Otto underneath it; the floating window must show Administration unavailable.
- A stale switch request or result after an account, organization, or epoch change must never change the visible mode.
- Returning to Administration must restore the retained conversation; only New chat, sign-out, or an account change may clear it.
- Switching while a send, preview, microphone capture, or recap audio is in flight must stop the old surface and must not leak a late result or double-play audio.
- The blazer and spectacles must remain attached, readable, and clear of the face and controls in every pose, both crops, and reduced-motion mode.

---

### Task 1: Shared view state and event contract

**Files:**
- Modify: `desktop/work-os-companion/src/adminOtto/mode.ts`
- Create: `desktop/work-os-companion/src/adminOtto/viewSwitch.ts`
- Create: `desktop/work-os-companion/src/adminOtto/viewSwitch.test.ts`
- Modify: `desktop/work-os-companion/src/tauriEvents.ts`

**Interfaces:**
- Consumes: `OttoMode`, `OttoScope`, `sameOttoScope`, `isOttoScope` from `mode.ts`.
- Produces: `OttoViewRole`, `OttoAdminStatus`, `OttoViewState`, `OttoViewRequest`, `OttoViewResult`, `OttoViewUnavailableReason`, constants `OTTO_VIEW_STATE_EVENT`, `OTTO_VIEW_REQUEST_EVENT`, `OTTO_VIEW_RESULT_EVENT`, `OTTO_CONVERSATION_EVENT`, `OTTO_RECORD_NAV_EVENT`; functions `resolveViewAvailability`, `buildOttoViewState`, `resolveWorkspaceSwitch`, `parseOttoViewState`, `parseOttoViewRequest`, `parseOttoViewResult`, `ottoConversationEvent`, `parseOttoConversationEvent`, `ottoRecordNavigationEvent`, `parseOttoRecordNavigationEvent`.

- [ ] **Step 1: Write the failing availability, switch, and parser tests**

```ts
// viewSwitch.test.ts
import { describe, expect, it } from "vitest";
import {
  buildOttoViewState, parseOttoViewRequest, parseOttoViewState,
  resolveViewAvailability, resolveWorkspaceSwitch,
} from "./viewSwitch";

const scope = { userId: "u1", organizationId: "o1", mode: "admin" as const };

describe("view availability", () => {
  it("offers both views only when the context is ready and a person is mapped", () => {
    expect(resolveViewAvailability({ role: "admin", adminStatus: "ready", personId: "p1" })).toEqual({
      employee: { available: true, reason: null },
      admin: { available: true, reason: null },
    });
  });

  it("does not offer Employee after a failed context read", () => {
    const result = resolveViewAvailability({ role: "admin", adminStatus: "failed", personId: "p1" });
    expect(result.employee).toEqual({ available: false, reason: "Your workspace is unavailable until Administration connects." });
    expect(result.admin).toEqual({ available: false, reason: "Administration is unavailable." });
  });

  it("names the loading state instead of guessing readiness", () => {
    expect(resolveViewAvailability({ role: "admin", adminStatus: "loading", personId: null }).admin)
      .toEqual({ available: false, reason: "Loading Administration…" });
  });
});

describe("workspace switch", () => {
  it("allows a ready mapped admin to move either way", () => {
    expect(resolveWorkspaceSwitch({ requested: "employee", current: "admin", role: "admin", adminStatus: "ready", personId: "p1" }))
      .toEqual({ ok: true });
  });

  it("refuses Employee when no personal workday is mapped", () => {
    expect(resolveWorkspaceSwitch({ requested: "employee", current: "admin", role: "admin", adminStatus: "ready", personId: null }))
      .toEqual({ ok: false, reason: "employee_unavailable" });
  });
});

describe("view events", () => {
  it("round-trips one complete sanitized view state", () => {
    const state = buildOttoViewState({
      scope, epoch: 4, workspace: "admin", role: "admin", adminStatus: "ready",
      personId: "p1", voiceAvailable: true, transcriptionAvailable: false,
      adminConversationId: "c1",
    });
    expect(parseOttoViewState(state)).toEqual(state);
    expect(state.employeeAvailable).toBe(true);
    expect(state.adminAvailable).toBe(true);
  });

  it("rejects a request without a scope or a known mode", () => {
    expect(parseOttoViewRequest({ requestId: "r1", scope, mode: "admin" })).not.toBeNull();
    expect(parseOttoViewRequest({ requestId: "r1", mode: "admin" })).toBeNull();
    expect(parseOttoViewRequest({ requestId: "r1", scope, mode: "owner" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new test file to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/adminOtto/viewSwitch.test.ts`

Expected: FAIL because `./viewSwitch` does not exist.

- [ ] **Step 3: Implement the contract and pure rules**

`viewSwitch.ts` exports exactly:

```ts
export type OttoViewRole = "admin" | "manager" | "employee";
export type OttoAdminStatus = "loading" | "ready" | "failed" | "absent";
export type OttoViewUnavailableReason =
  | "employee_unavailable" | "admin_unavailable" | "admin_loading" | "admin_failed";

export type OttoViewState = {
  scope: OttoScope;
  epoch: number;
  workspace: OttoMode;
  role: OttoViewRole;
  adminStatus: OttoAdminStatus;
  personId: string | null;
  employeeAvailable: boolean;
  adminAvailable: boolean;
  voiceAvailable: boolean;
  transcriptionAvailable: boolean;
  adminConversationId: string | null;
};

export type OttoViewRequest = { requestId: string; scope: OttoScope; mode: OttoMode };
export type OttoViewResult = {
  requestId: string; scope: OttoScope; mode: OttoMode;
  accepted: boolean; reason: OttoViewUnavailableReason | "stale_scope" | "switch_failed" | null;
};

export function resolveViewAvailability(input: {
  role: OttoViewRole | null; adminStatus: OttoAdminStatus; personId: string | null;
}): { employee: { available: boolean; reason: string | null }; admin: { available: boolean; reason: string | null } };

export function resolveWorkspaceSwitch(input: {
  requested: OttoMode; current: OttoMode; role: OttoViewRole | null;
  adminStatus: OttoAdminStatus; personId: string | null;
}): { ok: true } | { ok: false; reason: OttoViewUnavailableReason };

export function buildOttoViewState(input: Omit<OttoViewState, "employeeAvailable" | "adminAvailable">): OttoViewState;
```

Use these exact reasons: `Loading Administration…`, `Administration is unavailable.`, `No personal workday is mapped.`, `Loading your workspace…`, `Your workspace is unavailable until Administration connects.`

Add the event constants and strict parsers to `mode.ts`. `OTTO_CONVERSATION_EVENT` is `{ scope, epoch, conversationId: string | null }`; `OTTO_RECORD_NAV_EVENT` is `{ scope, epoch, url: string }`. Parsers reject a foreign scope shape, an epoch below 1, an empty id, an unknown mode, and non-boolean capability fields.

Add `OTTO_VIEW_STATE_EVENT`, `OTTO_VIEW_REQUEST_EVENT`, `OTTO_VIEW_RESULT_EVENT`, and `OTTO_CONVERSATION_EVENT` to the DEV `PREVIEW_EVENTS` allow-list in `tauriEvents.ts`. Do not add the record navigation event there; it is live-window only.

- [ ] **Step 4: Run the contract tests**

Run: `cd desktop/work-os-companion && npx vitest run src/adminOtto/viewSwitch.test.ts src/adminOtto/mode.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/adminOtto/mode.ts \
  desktop/work-os-companion/src/adminOtto/viewSwitch.ts \
  desktop/work-os-companion/src/adminOtto/viewSwitch.test.ts \
  desktop/work-os-companion/src/tauriEvents.ts
git commit -m "feat(companion): add the shared Otto view contract"
```

---

### Task 2: Main-window source of truth

**Files:**
- Modify: `desktop/work-os-companion/src/App.tsx`
- Modify: `desktop/work-os-companion/src/adminOtto/modeSurface.ts`
- Modify: `desktop/work-os-companion/src/adminOtto/modeSurface.test.ts`
- Modify: `desktop/work-os-companion/src/adminOtto/integration.test.ts`

**Interfaces:**
- Consumes: every exported symbol from Task 1.
- Produces: `requestWorkspaceMode(next: OttoMode): { ok: true } | { ok: false; reason: OttoViewUnavailableReason }`; published `OTTO_VIEW_STATE_EVENT`; request/result listener; conversation and record-navigation listeners.

- [ ] **Step 1: Write the failing mode-preservation test**

```ts
// modeSurface.test.ts
it("keeps the admin conversation id across a view switch", () => {
  expect(clearAdminOttoSurface("mode_switch", "conversation-1"))
    .toEqual({ entryOpen: false, conversationId: "conversation-1" });
});
```

Add these source guards to `integration.test.ts`:

```ts
it("publishes one view snapshot and accepts scoped switch requests", () => {
  expect(app).toContain("OTTO_VIEW_STATE_EVENT");
  expect(app).toContain("OTTO_VIEW_REQUEST_EVENT");
  expect(app).toContain("OTTO_VIEW_RESULT_EVENT");
  expect(app).toContain("buildOttoViewState(");
  expect(app).toContain("resolveWorkspaceSwitch(");
  expect(app).toContain("requestWorkspaceMode");
});

it("retains the admin conversation and draft across a view switch", () => {
  expect(app).not.toMatch(/setWorkspaceMode[\s\S]{0,500}setAdminOttoConversationId\(null\)/);
  expect(app).not.toMatch(/setWorkspaceMode[\s\S]{0,500}setAdminOttoDraft\(""\)/);
  expect(app).toContain("OTTO_CONVERSATION_EVENT");
  expect(app).toContain("OTTO_RECORD_NAV_EVENT");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop/work-os-companion && npx vitest run src/adminOtto/modeSurface.test.ts src/adminOtto/integration.test.ts`

Expected: FAIL on the current `clearAdminOttoSurface("mode_switch", id)` returning `conversationId: null` and the missing source guards.

- [ ] **Step 3: Implement the main-window switch and publishers**

- Change `clearAdminOttoSurface("mode_switch", id)` to close the surface and retain `id`. Only an explicit New chat, sign-out, or account change may set the id to `null`.
- Replace the inline `setWorkspaceMode` validation with `requestWorkspaceMode`. It returns the exact `resolveWorkspaceSwitch` result. Keep the existing notification copy for callers.
- In `setWorkspaceMode`, call `adminOttoModeRef.current?.switchMode(next)` and `setWorkspace(next)`, then persist `WORKSPACE_MODE_KEY`. When moving to Employee, close the admin sheet but do **not** clear `adminOttoConversationId`, `adminOttoDraft`, or `adminOttoRetryRequestId.current`.
- Build the view state with `buildOttoViewState` from `workspace`, the current `adminOttoSnapshot` (or selected mode), role, `adminContextState`, `personId`, voice/transcription capabilities, and the retained admin conversation id. Publish it in an effect whenever those inputs change and from the existing 30-second heartbeat while the avatar is visible.
- Add a listener for `OTTO_VIEW_REQUEST_EVENT`: parse it, compare `request.scope` to the current session/controller scope with `sameOttoScope`, call `requestWorkspaceMode`, and emit `OTTO_VIEW_RESULT_EVENT` with the same request id/scope/mode and accepted/reason.
- Add a listener for `OTTO_CONVERSATION_EVENT` that updates `adminOttoConversationId` only when the parsed scope and epoch match the current controller snapshot.
- Emit `OTTO_CONVERSATION_EVENT` from `handleAdminOttoConversation` and after every successful New chat reset. Keep the existing `OTTO_CHANGED_EVENT` behavior.
- Add a listener for `OTTO_RECORD_NAV_EVENT` that parses the event, checks the current controller scope/epoch, and calls `openAdminRecord(event.url)`.
- Do not clear the retained admin conversation when the admin sheet closes or the workspace changes. Sign-out/account replacement remains the clear boundary.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `cd desktop/work-os-companion && npx vitest run src/adminOtto/modeSurface.test.ts src/adminOtto/integration.test.ts src/adminOtto/viewSwitch.test.ts`

Run: `cd desktop/work-os-companion && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/App.tsx \
  desktop/work-os-companion/src/adminOtto/modeSurface.ts \
  desktop/work-os-companion/src/adminOtto/modeSurface.test.ts \
  desktop/work-os-companion/src/adminOtto/integration.test.ts
git commit -m "feat(companion): publish and switch the Otto view from main"
```

---

### Task 3: Shared mascot view switch

**Files:**
- Create: `desktop/work-os-companion/src/adminOtto/CompanionViewSwitch.tsx`
- Create: `desktop/work-os-companion/src/adminOtto/view-switch.css`
- Create: `desktop/work-os-companion/src/adminOtto/CompanionViewSwitch.render.test.ts`
- Modify: `desktop/work-os-companion/src/adminOtto/viewSwitch.ts`
- Modify: `desktop/work-os-companion/src/adminOtto/viewSwitch.test.ts`

**Interfaces:**
- Consumes: `MascotMark` from `../chat/MascotMark`; `OttoMode`; `resolveViewAvailability`.
- Produces:

```ts
export type CompanionViewSwitchProps = {
  mode: OttoMode;
  employeeAvailable: boolean;
  adminAvailable: boolean;
  employeeReason?: string | null;
  adminReason?: string | null;
  switchable?: boolean;            // false renders the static mark
  pending?: OttoMode | null;
  error?: string | null;
  onSwitch: (mode: OttoMode) => void;
  className?: string;
};

export function CompanionViewSwitch(props: CompanionViewSwitchProps): JSX.Element;
export function CompanionViewMenu(props: {
  open: boolean; mode: OttoMode; employeeAvailable: boolean; adminAvailable: boolean;
  employeeReason?: string | null; adminReason?: string | null;
  pending?: OttoMode | null; error?: string | null;
  onSwitch: (mode: OttoMode) => void; onClose: () => void;
  anchor?: { left: number; right: number; top: number; bottom: number } | null;
}): JSX.Element;
export function placeViewPopover(input: {
  anchor: { left: number; right: number; top: number; bottom: number };
  size: { width: number; height: number };
  viewport: { width: number; height: number };
}): { left: number; top: number };
```

- [ ] **Step 1: Write the failing static-state tests**

```ts
// CompanionViewSwitch.render.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanionViewMenu, CompanionViewSwitch, placeViewPopover } from "./CompanionViewSwitch";

const props = { mode: "employee" as const, employeeAvailable: true, adminAvailable: true, onSwitch: () => undefined };

it("renders one switch button with the current view in its accessible name", () => {
  const html = renderToStaticMarkup(createElement(CompanionViewSwitch, props));
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain("Employee");
  expect(html).toContain("data-view-switch");
});

it("states why an unavailable destination cannot be chosen", () => {
  const html = renderToStaticMarkup(createElement(CompanionViewMenu, {
    ...props, open: true, employeeAvailable: false, employeeReason: "No personal workday is mapped.",
  }));
  expect(html).toContain("No personal workday is mapped.");
  expect(html).toContain("Employee");
  expect(html).toContain("Admin");
});

it("places the popover inside both viewport edges", () => {
  expect(placeViewPopover({ anchor: { left: 2, right: 40, top: 80, bottom: 116 }, size: { width: 240, height: 160 }, viewport: { width: 420, height: 700 } }))
    .toEqual({ left: 8, top: 124 });
  expect(placeViewPopover({ anchor: { left: 390, right: 420, top: 80, bottom: 116 }, size: { width: 240, height: 160 }, viewport: { width: 420, height: 700 } }).left)
    .toBe(172);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop/work-os-companion && npx vitest run src/adminOtto/CompanionViewSwitch.render.test.ts`

Expected: FAIL because the component and placement helper do not exist.

- [ ] **Step 3: Implement the switch and popover**

- The button is 36×36px in the floating header and uses `MascotMark` with the current `mode`.
- The button's accessible name is `Otto view: Employee. Change view` or `Otto view: Admin. Change view`.
- `switchable: false` renders the mark in a span with no button or menu.
- The popover is a detached fixed-position menu rendered with `createPortal` to `document.body`; compute its top/left from the button rect and `placeViewPopover`. Clamp to an 8px viewport inset and place it below the button when there is room, otherwise above.
- The menu has `role="menu"`, two `role="menuitemradio"` items with `aria-checked`, arrow-key movement, Home/End, Enter/Space, Escape, and outside-pointerdown dismissal. Focus the current item on open and restore focus to the mascot on close.
- Unavailable items are `aria-disabled="true"` with the reason as a visible second line. Pending shows `Switching…` on the destination and disables both. Error renders as one local `role="alert"` line with the existing retry copy.
- The open menu states the employee/admin headings and the current choice; no raw IDs.
- CSS uses the shared raised surface, 12px radius, hairline, product easing, 220ms max, and a static final state under reduced motion.
- Keep the popover above the header and card layer (`z-index` above the conversation surface) without covering the close control.

- [ ] **Step 4: Run the component tests and typecheck**

Run: `cd desktop/work-os-companion && npx vitest run src/adminOtto/CompanionViewSwitch.render.test.ts src/adminOtto/viewSwitch.test.ts`

Run: `cd desktop/work-os-companion && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/adminOtto/CompanionViewSwitch.tsx \
  desktop/work-os-companion/src/adminOtto/view-switch.css \
  desktop/work-os-companion/src/adminOtto/CompanionViewSwitch.render.test.ts \
  desktop/work-os-companion/src/adminOtto/viewSwitch.ts \
  desktop/work-os-companion/src/adminOtto/viewSwitch.test.ts
git commit -m "feat(companion): add the mascot view switch"
```

---

### Task 4: Admin Otto floating presentation

**Files:**
- Modify: `desktop/work-os-companion/src/adminOtto/AdminOttoChat.tsx`
- Modify: `desktop/work-os-companion/src/adminOtto/adminOtto.css`
- Modify: `desktop/work-os-companion/src/adminOtto/AdminOttoChat.render.test.ts`
- Modify: `desktop/work-os-companion/src/adminOtto/designContract.test.ts`

**Interfaces:**
- Consumes: the existing `AdminOttoChatProps` and the shared `ConversationSurface`.
- Produces: `surface?: "in-app" | "floating"` (default `"in-app"`), `headerLeading?: ReactNode`, and `onHeaderMouseDown?: (event: React.MouseEvent<HTMLElement>) => void` on `AdminOttoChatProps`.

- [ ] **Step 1: Write the failing floating-variant render test**

```ts
it("renders the same admin conversation in the floating variant", () => {
  const html = renderToStaticMarkup(createElement(AdminOttoChat, {
    ...baseProps,
    surface: "floating",
    headerLeading: createElement("span", { "data-test-switch": "true" }, "switch"),
    onClose: () => undefined,
  }));
  expect(html).toContain('data-conversation-surface="floating"');
  expect(html).toContain('data-admin-otto-surface="floating"');
  expect(html).toContain('data-test-switch="true"');
  expect(html).toContain("New chat");
  expect(html).toContain("Recaps");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/adminOtto/AdminOttoChat.render.test.ts`

Expected: FAIL because `surface` is not accepted and the rendered surface is always in-app.

- [ ] **Step 3: Implement the floating variant**

- Pass `surface` to `ConversationSurface` and set `data-admin-otto-surface={surface}` on the sheet.
- Add `headerLeading` as the first child of the header and conditionally wrap the title area in `data-tauri-drag-region` when `surface === "floating"`.
- Attach `onHeaderMouseDown` to the header; the host supplies the existing `isHeaderDragStart` check.
- When floating, the close button remains the same but the host's `onClose` collapses the window.
- CSS: `.admin-otto-surface[data-admin-otto-surface="floating"]` fills the avatar window (`position: fixed; inset: 0; width: 100%; height: 100%; max-height: none;`) and keeps the conversation surface bounds. At 420px the header is one row or two deliberate rows; tabs, New chat, and close must stay visible. Use the shared conversation tokens.
- Keep all cards, composer, new-chat fencing, audio, and verification unchanged. The variant changes geometry and header leading only.
- Update `designContract.test.ts` to assert the floating surface rules exist and no second admin chat implementation is imported.

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `cd desktop/work-os-companion && npx vitest run src/adminOtto/AdminOttoChat.render.test.ts src/adminOtto/designContract.test.ts`

Run: `cd desktop/work-os-companion && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/adminOtto/AdminOttoChat.tsx \
  desktop/work-os-companion/src/adminOtto/adminOtto.css \
  desktop/work-os-companion/src/adminOtto/AdminOttoChat.render.test.ts \
  desktop/work-os-companion/src/adminOtto/designContract.test.ts
git commit -m "feat(companion): add the floating admin Otto presentation"
```

---

### Task 5: Floating window adopts and switches the view

**Files:**
- Modify: `desktop/work-os-companion/src/AvatarApp.tsx`
- Modify: `desktop/work-os-companion/src/avatar.css`
- Modify: `desktop/work-os-companion/src/avatarFixture.ts`
- Modify: `desktop/work-os-companion/src/avatarFixture.test.ts`
- Modify: `desktop/work-os-companion/src/adminOtto/integration.test.ts`
- Modify: `desktop/work-os-companion/src/visualizations.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts, Task 3 switch, Task 4 floating chat, `useAdminOttoRecapAudio`, `transcribeAdminOttoAudio`, `ADMIN_FIXTURE_TRANSPORT`.
- Produces: `AvatarApp` view-state adoption, `requestView(mode)`, Admin branch, Admin conversation sync, record navigation, and a DEV `avatar-view=admin` fixture.

- [ ] **Step 1: Write the failing fixture and wiring tests**

```ts
// avatarFixture.test.ts
it("recognizes the admin view fixture", () => {
  expect(avatarAdminViewFixtureRequested("?window=avatar&avatar-view=admin")).toBe(true);
  expect(avatarAdminViewFixtureRequested("?window=avatar&avatar-view=employee")).toBe(false);
});
```

Add source guards to `integration.test.ts`:

```ts
it("adopts the view snapshot and reuses the admin chat in the floating window", () => {
  expect(avatar).toContain("OTTO_VIEW_STATE_EVENT");
  expect(avatar).toContain("OTTO_VIEW_REQUEST_EVENT");
  expect(avatar).toContain("CompanionViewSwitch");
  expect(avatar).toContain("<AdminOttoChat");
  expect(avatar).toContain('surface="floating"');
  expect(avatar).toContain("OTTO_RECORD_NAV_EVENT");
  expect(avatar).toContain("OTTO_CONVERSATION_EVENT");
});

it("sends the actual scope with every view request", () => {
  expect(avatar).toContain("requestId");
  expect(avatar).toContain("scope:");
  expect(avatar).toContain("mode:");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop/work-os-companion && npx vitest run src/avatarFixture.test.ts src/adminOtto/integration.test.ts`

Expected: FAIL on the missing fixture helper and source guards.

- [ ] **Step 3: Implement the floating view state and request path**

- Add `viewState` to `AvatarApp`, adopted from `OTTO_VIEW_STATE_EVENT`. Default to employee only when no state exists and the account is not an admin. Never derive admin from a local toggle.
- Derive `workspaceView = viewState?.workspace ?? "employee"` and `adminScope = viewState?.scope.mode === "admin" ? viewState.scope : null`.
- Add `requestView`: create a request id, emit `OTTO_VIEW_REQUEST_EVENT` with `{ requestId, scope: viewState.scope, mode }`, set pending, and wait for a matching `OTTO_VIEW_RESULT_EVENT` or a view state with the target workspace. Refuse an unavailable destination locally with the same reason the snapshot carries. On account/session change, clear pending and ignore old results.
- Add a timeout of 5 seconds. On timeout or refusal, keep the current view and show the error in the popover.
- Replace the employee header mark with `CompanionViewSwitch` when the account can switch; pass availability, reasons, pending, and error. Keep a static `MascotMark` for non-admins.
- Render the Admin branch inside the floating window:
  - Expanded: `<AdminOttoChat surface="floating" headerLeading={<CompanionViewSwitch ... />} ... />`.
  - Collapsed: the existing compact shell with `MascotPet mode="admin"`, an `Admin` pill, and no employee prompt bubbles.
  - If `workspaceView === "admin"` but no admin context is ready: render the compact/expanded shell with a bounded `Administration Otto is unavailable` panel and the switch. Do not render Employee Otto.
- Pass the admin conversation id from `viewState`/local state; on `onConversation`, update it and emit `OTTO_CONVERSATION_EVENT` with the current scope/epoch. On `onNewChat`, set it to null and emit the same event after the server fence completes.
- Use `useAdminOttoRecapAudio` with the admin scope/epoch, `voice: recapVoice`, `enabled: viewState.voiceAvailable`, and `onListened` updating delivery. Pass `playback`, `recapUpdates`, `onListen`, `onStopListening`, `transcriptionEnabled`, and `transcribeAdminOttoAudio` into `AdminOttoChat`.
- On `onOpenRecord`, emit `OTTO_RECORD_NAV_EVENT` with the current scope/epoch and the URL. Main validates it.
- On `onClose`, collapse the avatar window; on new chat, let `AdminOttoChat` do its existing durable fence.
- Add the DEV fixture `avatarAdminViewFixtureRequested` and make `?window=avatar&avatar-view=admin` render the actual admin branch with `ADMIN_FIXTURE_TRANSPORT`, a fixture scope, and the fixture switch availability. The fixture must not call `/api`.
- CSS: admin header and panel use the shared conversation tokens; the switch/Admin chip are visible at 420px; the collapsed Admin pill is legible; no horizontal overflow.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `cd desktop/work-os-companion && npx vitest run src/avatarFixture.test.ts src/adminOtto/integration.test.ts src/visualizations.test.ts`

Run: `cd desktop/work-os-companion && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Render the actual fixture**

Run the Vite dev server in the companion package, then open:

- `/?window=avatar&avatar-fixture=recorded-completion` for Employee.
- `/?window=avatar&avatar-view=admin` for Administration.

Inspect 420px and 390px widths; switch popover open/closed/pending/error; New chat; collapsed orb. Capture screenshots under `/tmp/opencode/`.

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/AvatarApp.tsx \
  desktop/work-os-companion/src/avatar.css \
  desktop/work-os-companion/src/avatarFixture.ts \
  desktop/work-os-companion/src/avatarFixture.test.ts \
  desktop/work-os-companion/src/adminOtto/integration.test.ts \
  desktop/work-os-companion/src/visualizations.test.ts
git commit -m "feat(companion): switch the floating Otto view"
```

---

### Task 6: Mascot Administration outfit and costume transition

**Delegate this task to a `general` subagent running model `openai/gpt-6.1-sol#high`.** The main agent must not edit these files while the subagent works. Review the result before integration.

**Subagent prompt:**

> Build the Administration outfit for Studio Otto in `/home/maigreeks/projects/.worktrees/mascot-view-switch`. Read `AGENTS.md`, the design spec at `docs/superpowers/specs/2026-11-05-mascot-view-switch-design.md`, and the current mascot files. Add a mode-driven blazer and brass spectacles, a one-shot dressing/removing transition for the collapsed floating orb, and the final static state under reduced motion. Do not change the mascot identity, the existing poses, or the floating chat wiring. Run the focused mascot tests and typecheck. Commit only the mascot files and their tests.

**Files:**
- Modify: `desktop/work-os-companion/src/mascotTypes.ts`
- Modify: `desktop/work-os-companion/src/chat/MascotMark.tsx`
- Modify: `desktop/work-os-companion/src/MascotPet.tsx`
- Modify: `desktop/work-os-companion/src/StudioOtto.tsx`
- Modify: `desktop/work-os-companion/src/studio-otto.css`
- Modify: `desktop/work-os-companion/src/OttoPreview.tsx`
- Create: `desktop/work-os-companion/src/mascotAttire.ts`
- Create: `desktop/work-os-companion/src/mascotAttire.test.ts`
- Modify: `desktop/work-os-companion/src/StudioOtto.test.tsx`
- Modify: `test/work-os-companion-mascot.test.mts`

**Interfaces:**
- Produces: `MascotMode = "employee" | "admin"` in `mascotTypes.ts`; `mode?: MascotMode` on `MascotRendererProps`, `MascotMarkProps`, and `MascotPetProps`; `attireTransition?: "on" | "off" | null` on `MascotRendererProps`; `nextAttireTransition(previous: MascotMode, next: MascotMode): "on" | "off" | null` in `mascotAttire.ts`.

- [ ] **Step 1: Write the failing transition and markup tests**

```ts
// mascotAttire.test.ts
import { expect, it } from "vitest";
import { nextAttireTransition } from "./mascotAttire";

it("dresses when entering admin and undresses when leaving", () => {
  expect(nextAttireTransition("employee", "admin")).toBe("on");
  expect(nextAttireTransition("admin", "employee")).toBe("off");
  expect(nextAttireTransition("employee", "employee")).toBeNull();
});
```

```tsx
// StudioOtto.test.tsx additions
it("renders the administration accessories in every pose", () => {
  for (const pose of MASCOT_POSES) {
    const html = renderToStaticMarkup(createElement(StudioOtto, { pose, mode: "admin" }));
    expect(html).toContain('data-mode="admin"');
    expect(html).toContain("studio-admin-blazer");
    expect(html).toContain("studio-admin-specs");
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop/work-os-companion && npx vitest run src/mascotAttire.test.ts src/StudioOtto.test.tsx`

Expected: FAIL because the mode/transition types and accessory groups do not exist.

- [ ] **Step 3: Implement the outfit and transition**

- Add the mode and transition props through `mascotTypes.ts`, `StudioOtto`, `MascotMark`, and `MascotPet`.
- Always render the accessory groups in `StudioOtto`; set `data-mode={mode}` and `data-attire-transition={attireTransition ?? undefined}` on the SVG.
- Blazer: charcoal open-front jacket, narrow lapels, signal pocket square, brass lapel pin. It must leave the chassis controls and screen face unobstructed. Full crop shows the jacket; head crop shows spectacles and a collar hint.
- Spectacles: thin brass frames with transparent lenses and a bridge; do not cover the terminal face or pose glyphs.
- `MascotPet` detects a mode change and shows the transition for a bounded 700ms, then clears it. `nextAttireTransition` supplies the direction. It must not animate on initial mount, collapse/expand, or unrelated rerenders.
- `MascotMark` renders the final state only; it does not own timers.
- CSS transitions: jacket settles from the shoulders over roughly 280ms; spectacles fold over roughly 220ms after a short beat. Removing reverses them. No overshoot, no loop.
- Under `prefers-reduced-motion: reduce`, show the final accessories immediately and remove the transitions.
- Extend `OttoPreview` with an `Employee / Admin` control and a `Dress / Undress` replay so the outfit can be inspected across all poses, both crops, dark/light, and reduced motion.
- Update the mascot guard to assert `data-mode`, `studio-admin-blazer`, `studio-admin-specs`, and the reduced-motion rule.

- [ ] **Step 4: Run focused tests, typecheck, and the mascot guard**

Run: `cd desktop/work-os-companion && npx vitest run src/mascotAttire.test.ts src/StudioOtto.test.tsx src/StudioOttoSpeaking.render.test.ts`

Run: `cd desktop/work-os-companion && npx tsc --noEmit`

Run: `PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH node --import tsx --test test/work-os-companion-mascot.test.mts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/mascotTypes.ts \
  desktop/work-os-companion/src/mascotAttire.ts \
  desktop/work-os-companion/src/mascotAttire.test.ts \
  desktop/work-os-companion/src/chat/MascotMark.tsx \
  desktop/work-os-companion/src/MascotPet.tsx \
  desktop/work-os-companion/src/StudioOtto.tsx \
  desktop/work-os-companion/src/StudioOtto.test.tsx \
  desktop/work-os-companion/src/studio-otto.css \
  desktop/work-os-companion/src/OttoPreview.tsx \
  test/work-os-companion-mascot.test.mts
git commit -m "feat(companion): dress Otto for administration"
```

---

### Task 7: Wire the costume into both windows and finish the visual fixture

**Files:**
- Modify: `desktop/work-os-companion/src/AvatarApp.tsx`
- Modify: `desktop/work-os-companion/src/adminOtto/AdminOttoChat.tsx`
- Modify: `desktop/work-os-companion/src/chat/MascotMark.tsx`
- Modify: `desktop/work-os-companion/src/admin/AdminPreview.tsx`
- Modify: `desktop/work-os-companion/src/adminOtto/adminOtto.css`
- Modify: `desktop/work-os-companion/src/avatar.css`
- Modify: `desktop/work-os-companion/src/visualizations.test.ts`

**Interfaces:**
- Consumes: Task 5 view state and Task 6 `mode`/`attireTransition`.
- Produces: mode-aware marks in both headers, static outfit in chat marks, and a 420px floating Admin preview.

- [ ] **Step 1: Write the failing wiring and preview guards**

```ts
it("passes the authoritative view mode to both mascot renders", () => {
  expect(avatar).toContain('mode={workspaceView}');
  expect(avatar).toContain('mode="admin"');
  expect(adminOttoChat).toContain("headerLeading");
  expect(adminPreview).toContain('surface="floating"');
});
```

- [ ] **Step 2: Run the guard to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/visualizations.test.ts`

Expected: FAIL on the missing mode/header/preview wiring.

- [ ] **Step 3: Implement the wiring and preview**

- Pass `mode={workspaceView}` into the floating `MascotPet` and both `CompanionViewSwitch` instances. Pass `mode="admin"` into admin chat marks through `MascotMark`; employee marks stay `"employee"`.
- The header switch mark must render the final accessories and animate through its own `MascotMark` transition if Task 6 exposes one. Do not add a second animation implementation in `AvatarApp`.
- Extend `AdminPreview` so `?preview-admin&otto=chat&surface=floating` renders the actual floating AdminOttoChat variant inside a 420×680 frame with a fixture switch. The fixture must not call the API. This is the visual QA surface for the floating header, popover, cards, and New chat.
- Add CSS for the Admin chip and collapsed `Admin` pill. Use the ink chip with the brass pin; no permanent gradient.
- Ensure the open admin header at 420px keeps the switch, tabs, New chat, and close visible. If the existing title does not fit, shorten the visible subtitle before hiding any control; never hide New chat or close.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `cd desktop/work-os-companion && npx vitest run src/visualizations.test.ts src/adminOtto/integration.test.ts src/adminOtto/CompanionViewSwitch.render.test.ts`

Run: `cd desktop/work-os-companion && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Render visual acceptance states**

Run the companion Vite server. Capture and inspect:

- `?preview-admin&otto=chat&surface=floating` at 420px and 390px; popover closed/open/pending/error; Admin cards; New chat.
- `?window=avatar&avatar-view=admin` at 420px; expanded, collapsed, New chat, switch to Employee.
- `?window=avatar&avatar-fixture=recorded-completion` at 420px; switch popover and employee header.
- `?preview-otto` at 1440px; every pose in Employee and Admin, full/head crop, reduced motion.
- `?preview-admin` at 1440px; in-app Admin Otto header with the switch.

Save screenshots under `/tmp/opencode/mascot-view-switch/`. Check keyboard focus, Escape, outside dismissal, no clipped labels, and no horizontal overflow.

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/AvatarApp.tsx \
  desktop/work-os-companion/src/adminOtto/AdminOttoChat.tsx \
  desktop/work-os-companion/src/chat/MascotMark.tsx \
  desktop/work-os-companion/src/admin/AdminPreview.tsx \
  desktop/work-os-companion/src/adminOtto/adminOtto.css \
  desktop/work-os-companion/src/avatar.css \
  desktop/work-os-companion/src/visualizations.test.ts
git commit -m "feat(companion): show the Otto view everywhere"
```

---

### Task 8: Documentation, queue, and release preparation

**Files:**
- Modify: `design.md`
- Modify: `desktop/work-os-companion/CHANGELOG.md`
- Modify: `desktop/work-os-companion/release-queue.json`
- Create: `docs/verification/2026-11-05-mascot-view-switch.md`
- Modify: `desktop/work-os-companion/package.json` (only when release-eligible)
- Modify: `desktop/work-os-companion/src-tauri/tauri.conf.json` (only when release-eligible)
- Modify: `desktop/work-os-companion/src-tauri/Cargo.toml` (only when release-eligible)

**Interfaces:**
- Consumes: all verification evidence from Tasks 1-7.
- Produces: canonical blueprint text, one plain-language changelog note, one append-only queue outcome, a verification record, and the conditional fifth-update release metadata.

- [ ] **Step 1: Update the blueprint**

Add to `design.md` §7.3 and §13:

- the mascot view switch and its anchored popover;
- the matching conversation and cross-window switch contract;
- the retained admin conversation across view changes;
- the blazer/spectacles accessory layer and the one-shot reduced-motion contract;
- the collapsed Admin label.

- [ ] **Step 2: Add the changelog and queue outcome**

Under `## Unreleased`:

```
- Administrators can switch the floating mascot between Employee and Admin views, with the matching conversation and a tailored Admin Otto outfit.
```

Append one queue record (never remove prior entries):

```json
{
  "id": "floating-otto-view-switch",
  "type": "feature",
  "summary": "Administrators can switch the floating mascot between Employee and Admin views, with the matching conversation and a tailored Admin Otto outfit.",
  "verification": "Actual focused and full test commands, rendered checks, and screenshot paths recorded in docs/verification/2026-11-05-mascot-view-switch.md."
}
```

- [ ] **Step 3: Check release eligibility**

Run: `PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH npm run companion:release:status`

Expected: `pendingCount` is 5 and `eligible` is true. If another agent's outcome landed first, leave the version at `0.5.22`, keep the queue append-only, and record that this update waits for the next batch.

If eligible, bump one patch from the latest published version (`0.5.22` → `0.5.23`), synchronize `package.json`, `tauri.conf.json`, and `Cargo.toml`, and move the Unreleased section to `## 0.5.23 — 2026-11-05`. Do not create a tag or dispatch packaging in this branch.

- [ ] **Step 4: Write the verification record**

Record exact commands and results for:

- focused view/switch/chat/mascot tests;
- companion full suite;
- Work OS typecheck and full suite;
- production build;
- Playwright/rendered states and screenshot paths;
- TestSprite if a reusable fixture exists;
- CodeRabbit one pass and every still-valid finding;
- release-gate status.

- [ ] **Step 5: Commit**

```bash
git add design.md desktop/work-os-companion/CHANGELOG.md \
  desktop/work-os-companion/release-queue.json \
  docs/verification/2026-11-05-mascot-view-switch.md
# Add the three version files only if eligible.
git commit -m "docs(companion): record the Otto view switch"
```

---

### Task 9: Full gate and release acceptance

**Files:** no production edits unless a gate finds a real failure.

- [ ] **Step 1: Run the complete companion suite**

Run: `cd desktop/work-os-companion && npx vitest run`

Expected: 0 failures.

- [ ] **Step 2: Run the Work OS gates**

Run: `PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH npm run work-os:typecheck`

Run: `PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH npm run work-os:test`

Run: `PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH npm run build`

Expected: typecheck and build clean; full suite 0 failures, with the 11 opt-in PostgreSQL tests reported as skipped.

- [ ] **Step 3: Run review and release checks**

Run CodeRabbit once over the completed batch and fix every still-valid finding.

Run: `PATH=/home/zahemen/.nvm/versions/node/v22.20.0/bin:$PATH npm run companion:release:status`

Expected: eligible and version metadata synchronized if this is the fifth update.

- [ ] **Step 4: Verify the installed/release path**

If a release is prepared, follow `docs/companion-release-policy.md`: merge to main, monitor the single automatic release pipeline, and verify the published installer/updater. Do not push a tag or dispatch packaging manually unless the policy requires a retry.

If this update is not fifth, stop after merge and leave the queue pending.

- [ ] **Step 5: Commit any gate fix**

```bash
git add <changed files>
git commit -m "fix(companion): close the Otto view switch gate"
```

**Execution note:** The mascot task (Task 6) is the only work that should be delegated. Start it in the background with `subagent` model `openai/gpt-6.1-sol#high` while the main agent works Tasks 1-5. The main agent owns integration, the full gate, and the final claim.

## Self-review

- Spec coverage: view state, switch, matching conversations, cross-window sync, admin floating chat reuse, chat/recap/audio/record behavior, costume, reduced motion, edge states, QA, release policy — each maps to a task above.
- The plan deliberately keeps AdminOttoChat as one implementation; the floating variant changes geometry and header leading only.
- The plan does not add a Tauri command, a second authorization path, or a second mascot renderer.
- Types and event names are defined once in Task 1 and referenced consistently.
- The fifth-update release check is conditional on the live queue, so another agent's outcome cannot be consumed by accident.
