# First Light Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the companion's pre-app loading screen with the First Light scene (Otto at a bench of light instead of the equalizer wave) and choreograph the Morning Rise handoff into the workspace, held until real content is ready.

**Architecture:** One persistent boot overlay at the App level spans both loading phases (vault gate → day read); a pure `bootScreen.ts` resolver decides which surface is up (the day hold is a resolver rule); `BootHandoff.tsx` owns the First Light surface and the landing → exit machine; CSS in `loading.css` does all motion.

**Tech Stack:** React (companion app, no new dependencies), CSS keyframes + Web Animations API for the pulse landing, vitest (`renderToStaticMarkup`) + root node static tests.

**Spec:** `docs/superpowers/specs/2026-10-16-first-light-launch-design.md` — read it first; this plan argues from it.

**Worktree:** `/home/maigreeks/projects/.worktrees/first-light-launch` (branch `codex/first-light-launch`, `node_modules` already symlinked). All edits, tests, and commits happen there. Line anchors below are from this worktree at plan time; locate by symbol if they drift.

## Global Constraints (from the spec + design.md)

- Night canvas `#171914` + radial `rgba(168,241,91,.1)` unchanged; bench hairline `rgba(237,244,238,.16)`, `width: clamp(220px, 44vw, 300px)`; pulse signal `#a8f15b`, soft gradient, ~2px blur.
- Pulse loop: crossing 3.4s ease-in-out with a ~600ms quiet rest (spec §3 keyframe shape).
- Landing ≤300ms (accelerated crossing) + ~150ms landed hold; exit 640ms `cubic-bezier(.2,.8,.2,1)`; workspace rise 8px paired with the night lift 8px; reduced motion: no landing, no transforms, one ~150ms opacity fade.
- Truth: stage lines come only from `BOOT_STAGE_COPY`; the exit starts only when the next surface will render real content (`visibleDay || error`, admin: session/role resolved); no timers that fake readiness; `boot:*` phases stay data-driven.
- The failed/recovery branch of `LoadingScreen`, `ConnectScreen`, `Onboarding`, in-app `Wave`/`FadeArc`/skeleton usage, and the web console are untouched.
- No new fonts, assets, or npm dependencies. Desktop-only (companion). Otto renders only through `MascotPet` with the exact classes `mascot-loading` / `mascot-loading-art`.
- Run tests with the native WSL Node toolchain (`node`/`npm` from `/home/zahemen/.nvm/versions/node/v24.20.0/bin` on PATH; a child script must use the same PATH).
- Every release-facing surface change gets one plain employee-readable CHANGELOG bullet (Task 6).
- One CodeRabbit pass at batch end: `coderabbit review --agent --base-commit 8aba3f1d` (Task 7).

## Review Focus

Failure modes the spec implies but component tests can't fully pin — each is covered by the named test:

1. **Slow or failed day fetch must never boot the skeleton workspace behind the overlay** — the hold keeps First Light up until `visibleDay || error`; a failure exits to content the way today's error flow does. Pinned by the `bootScreen` truth-table rows (Task 2) and the App wiring assertions (Task 4).
2. **Vault → day phase swap must not remount Otto or the bench** — the overlay renders in one stable slot across loading phases, only the stage text changes, and the `role="status"` line announces it. Pinned by the render tests' stable shape (children slot / overlay slot, Task 3) and the live phase-swap QA pass (Task 7).
3. **An exiting overlay must never block the workspace** — `pointer-events: none` during exit, unmount on completion. Pinned by the exit-class assertions (Task 3) and the rendered handoff pass (Task 7).
4. **Reduced motion** — no landing, no traveling pulse, no breath, no rise; the 150ms fade is the only transition. Pinned by the static `prefers-reduced-motion` selector-list assertions (Tasks 1, 3, 4).
5. **The workspace entrance must play only through the boot handoff** — never on admin↔employee switches or other remounts. Pinned by `bootRiseClass` truth table (Task 2) and the `boot-rise` wiring assertion (Task 4).

---

### Task 1: The Bench loader (`Bench`) — replaces the equalizer on the launch screen only

**Files:**
- Modify: `desktop/work-os-companion/src/LoadingUi.tsx` (add `Bench` next to `Wave`, ~line 15)
- Modify: `desktop/work-os-companion/src/loading.css` (bench styles near the wave block, ~line 28; extend the reduced-motion list at ~line 501)
- Test: `desktop/work-os-companion/src/loadingUi.render.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Bench({ className }: React.ComponentProps<"span">)` — a decorative, `aria-hidden` loader. Task 3 consumes it; no other surface changes.

- [ ] **Step 1: Write the failing test**

Append to `loadingUi.render.test.ts` (import `Bench` from `./LoadingUi`):

```ts
it("bench renders a decorative hairline with one traveling pulse, no status role", () => {
  const markup = renderToStaticMarkup(createElement(Bench));
  expect(markup).toContain('class="loading-bench"');
  expect(markup).toContain('class="loading-bench-pulse"');
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).not.toContain('role="status"');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/loadingUi.render.test.ts`
Expected: FAIL — `Bench` is not exported.

- [ ] **Step 3: Implement `Bench` in `LoadingUi.tsx`**

```tsx
/** First Light bench: a decorative hairline under Otto with one soft light
 * pulse. Crossing → rest shape lives in the keyframes (see loading.css). */
export function Bench({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={`loading-bench${className ? ` ${className}` : ""}`} aria-hidden="true" {...props}>
    <span className="loading-bench-pulse" />
  </span>;
}
```

- [ ] **Step 4: Add the bench CSS to `loading.css`** (after the `.loading-wave-bar` block; values verbatim from the spec):

```css
.loading-bench {
  position: relative;
  width: clamp(220px, 44vw, 300px);
  height: 1px;
  margin: 26px 0 4px;
  background: rgba(237, 244, 238, 0.16);
}

.loading-bench-pulse {
  position: absolute;
  top: -1.5px;
  left: -24%;
  width: 22%;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, #a8f15b, transparent);
  filter: blur(2px);
  opacity: 0;
  animation: bench-sweep 3.4s ease-in-out infinite;
}

@keyframes bench-sweep {
  0% { left: -24%; opacity: 0; }
  9% { opacity: 1; }
  76% { left: 98%; opacity: 1; }
  82% { left: 100%; opacity: 0; }
  100% { left: 100%; opacity: 0; }
}
```

Add `.loading-bench-pulse` to the `prefers-reduced-motion` animation kill list at the bottom of `loading.css` (the block that already lists `.loading-wave-bar`, `.loading-arc`, `.skeleton`, `.loading-shell`, `.workspace`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd desktop/work-os-companion && npx vitest run src/loadingUi.render.test.ts`
Expected: PASS (wave tests unchanged — `Wave` stays for in-app major waits).

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/LoadingUi.tsx desktop/work-os-companion/src/loading.css desktop/work-os-companion/src/loadingUi.render.test.ts
git commit -m "feat(companion): bench loader for First Light"
```

---

### Task 2: The boot screen resolver (`bootScreen.ts`) — pure, truth-table tested

**Files:**
- Create: `desktop/work-os-companion/src/bootScreen.ts`
- Test: `desktop/work-os-companion/src/bootScreen.test.ts`

**Interfaces:**
- Consumes: nothing (pure module; no React, no imports).
- Produces (Tasks 3 & 4 consume these exact names):

```ts
export type BootSurface = "connect" | "onboarding" | "admin" | "workspace";
export type BootScreen =
  | { kind: "loading"; phase: "vault" | "day" }
  | { kind: "failed" }
  | { kind: "content"; surface: BootSurface };

/** Exact stage copy; the apostrophe is U+2019 exactly as today. */
export const BOOT_STAGE_COPY = {
  vault: "Opening this device’s saved session",
  day: "Reading your schedule and workday",
} as const;

export interface BootState {
  vault: "pending" | "failed" | "opened";
  hasSession: boolean;
  adminReady: boolean;
  onboarding: { onboardingRequired: boolean } | null;
  dayReady: boolean;
  dayFailed: boolean;
}

export function resolveBootScreen(state: BootState): BootScreen;

/** ".workspace boot-rise" only through a loading→content handoff; "" otherwise. */
export function bootRiseClass(previous: BootScreen["kind"] | null, current: BootScreen["kind"]): string;
```

- [ ] **Step 1: Write the failing truth-table test** (`bootScreen.test.ts`, body of `resolveBootScreen` is the truth table):

```ts
import assert from "node:assert/strict";
import { bootRiseClass, BOOT_STAGE_COPY, resolveBootScreen } from "./bootScreen";

const base = { vault: "opened", hasSession: true, adminReady: false, onboarding: { onboardingRequired: false }, dayReady: false, dayFailed: false } as const;

// Resolution order is today's gate chain + the §4.1 hold:
assert.deepEqual(resolveBootScreen({ ...base, vault: "pending" }), { kind: "loading", phase: "vault" });
assert.deepEqual(resolveBootScreen({ ...base, vault: "failed" }), { kind: "failed" });
assert.deepEqual(resolveBootScreen({ ...base, hasSession: false }), { kind: "content", surface: "connect" });
assert.deepEqual(resolveBootScreen({ ...base, onboarding: null }), { kind: "loading", phase: "day" });
assert.deepEqual(resolveBootScreen({ ...base, onboarding: { onboardingRequired: true } }), { kind: "content", surface: "onboarding" });
assert.deepEqual(resolveBootScreen({ ...base, adminReady: true }), { kind: "content", surface: "admin" });
// The hold: real content (§4.1) — no day yet, no failure → stay on First Light.
assert.deepEqual(resolveBootScreen(base), { kind: "loading", phase: "day" });
assert.deepEqual(resolveBootScreen({ ...base, dayReady: true }), { kind: "content", surface: "workspace" });
assert.deepEqual(resolveBootScreen({ ...base, dayFailed: true }), { kind: "content", surface: "workspace" });

// Stage copy is exact, apostrophe included.
assert.equal(BOOT_STAGE_COPY.vault, "Opening this device’s saved session");
assert.equal(BOOT_STAGE_COPY.day, "Reading your schedule and workday");

// bootRiseClass: only a loading→content handoff rises.
assert.equal(bootRiseClass("loading", "content"), "workspace boot-rise");
assert.equal(bootRiseClass(null, "content"), "workspace");
assert.equal(bootRiseClass("content", "content"), "workspace");
assert.equal(bootRiseClass(null, "loading"), "workspace");
assert.equal(bootRiseClass("failed", "content"), "workspace");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/bootScreen.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `bootScreen.ts`**

Body of `resolveBootScreen` (exact order — it mirrors App.tsx's gate chain plus the new rule 7):

```ts
if (state.vault === "pending") return { kind: "loading", phase: "vault" };
if (state.vault === "failed") return { kind: "failed" };
if (!state.hasSession) return { kind: "content", surface: "connect" };
if (!state.onboarding) return { kind: "loading", phase: "day" };
if (state.onboarding.onboardingRequired) return { kind: "content", surface: "onboarding" };
if (state.adminReady) return { kind: "content", surface: "admin" };
// §4.1 hold: the workspace exits boot only once it will render real content.
if (!state.dayReady && !state.dayFailed) return { kind: "loading", phase: "day" };
return { kind: "content", surface: "workspace" };
```

`bootRiseClass`: return `"workspace boot-rise"` only when `previous === "loading" && current === "content"`; `"workspace"` otherwise.

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop/work-os-companion && npx vitest run src/bootScreen.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/bootScreen.ts desktop/work-os-companion/src/bootScreen.test.ts
git commit -m "feat(companion): boot screen resolver with real-content hold"
```

---

### Task 3: `BootHandoff.tsx` — First Light surface + Morning Rise overlay

**Files:**
- Create: `desktop/work-os-companion/src/BootHandoff.tsx`
- Modify: `desktop/work-os-companion/src/loading.css` (boot overlay + exit + rise + breath styles)
- Test: `desktop/work-os-companion/src/bootHandoff.render.test.ts`

**Interfaces:**
- Consumes: `Bench`, `BOOT_STAGE_COPY` (Tasks 1–2), `MascotPet` from `./MascotPet`.
- Produces (Task 4 consumes):

```tsx
/** First Light loading surface (replaces LoadingScreen's non-failed branch). */
export function FirstLightSurface({ stage }: { stage: string }): JSX.Element;

/** Persistent boot overlay: renders the First Light surface while `screen` is
 * loading; on a loading→content handoff plays Landing→Rise above `children`.
 * Never renders children while loading. `onExitStart` fires once per handoff. */
export function BootOverlay({ screen, children, onExitStart }: {
  screen: Exclude<BootScreen, { kind: "failed" }>;
  children: ReactNode;
  onExitStart?: () => void;
}): JSX.Element;

/** Thin wrapper over bootRiseClass — App hooks it up for `.workspace`. */
export function useBootRise(screen: BootScreen): string;
```

- [ ] **Step 1: Write the failing render tests** (`bootHandoff.render.test.ts`, vitest + `renderToStaticMarkup`, mirroring the style of `loadingUi.render.test.ts`):

```ts
// While loading: the overlay IS the First Light surface; children are absent.
it("loading renders the First Light surface without children", () => {
  const markup = renderToStaticMarkup(createElement(BootOverlay, { screen: { kind: "loading", phase: "day" } }, createElement("div", { id: "content" })));
  expect(markup).toContain('class="loading"');          // .loading shell reused
  expect(markup).toContain("Getting your day ready");
  expect(markup).toContain('role="status"');            // stage line announces
  expect(markup).toContain(BOOT_STAGE_COPY.day);
  expect(markup).toContain("loading-bench");            // Task 1's Bench
  expect(markup).not.toContain('id="content"');
});

// Content on first render (no prior loading — e.g. the admin fixture): children only.
it("content-first renders children with no exit machinery", () => {
  const markup = renderToStaticMarkup(createElement(BootOverlay, { screen: { kind: "content", surface: "workspace" } }, createElement("div", { id: "content" })));
  expect(markup).toContain('id="content"');
  expect(markup).not.toContain("boot-exit");
});

// The static render pins the exit CLASS names the client state machine applies;
// the machine itself (landing → exiting → done) is reviewed via the preview in Task 5.
it("declares the exit classes and reduced-motion fade in markup source", () => {
  const source = readFileSync(new URL("./BootHandoff.tsx", import.meta.url), "utf8");
  expect(source).toContain("boot-exit");
  expect(source).toContain("boot-exit-reduced");
  expect(source).toContain("bootRiseClass(");
});
```

(`readFileSync` via `node:fs` import; adjust to the file's existing import style.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop/work-os-companion && npx vitest run src/bootHandoff.render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BootHandoff.tsx`**

`FirstLightSurface` — the composition from spec §3, moved verbatim from `LoadingScreen`'s non-failed branch (App.tsx:4348-4352), with the paragraph removed, Wave → Bench, and the stage line promoted:

```tsx
export function FirstLightSurface({ stage }: { stage: string }) {
  return <main className="loading"><div className="loading-shell">
    <MascotPet isolated agent="working" workday="active" className="mascot-loading" artClassName="mascot-loading-art" />
    <h1>Getting your day ready</h1>
    <Bench /><small className="loading-stage" role="status">{stage}</small>
  </div></main>;
}
```

(`useBootRise(screen)` = `useState` + ref over `bootRiseClass`; App will spread it onto `.workspace`. ~12 lines; body left to the implementer.)

`BootOverlay` client state machine — the contract the implementation must satisfy (spec §4; this is the one non-obvious algorithm, so its shape is pinned):

```
exit: "idle" | "landing" | "exiting" | "done"   (useState)
prevKind: ref                                    (loading→content detection)

on screen.kind==="content" && prevKind==="loading" && reduced-motion off:
  exit = "landing"
  · pulse = overlayRef.querySelector(".loading-bench-pulse"); anim = pulse.getAnimations()[0]
  · phase = (anim.currentTime % 3400) ms within the sweep's travel window
      (0.29s … 2.79s of the cycle): cancel anim; WAAPI animate computed left →
      100% at opacity 1, duration = clamp(120..300, remaining × 0.4) ms
  · then hold the landed pulse ~150ms (setTimeout), then exit = "exiting"
on ready with reduced motion, or phase outside the travel window (bench resting):
  exit = "exiting" immediately (no landing beat)
"exiting": add "boot-exit" class (or "boot-exit-reduced" when reduced motion);
  advance to "done" on animationend with a 750ms timeout fallback (170ms reduced)
"done": overlay unmounts (return children only)
content→loading (debug scenario flips back): reset exit to "idle"
```

Render shape (DOM must be stable across loading phases — Review Focus 2):

```tsx
if (exit === "done") return <>{children}</>;
return <>
  {children}   {/* mounted only when screen.kind === "content" */}
  {overlayVisible && <div ref={overlayRef} className={`boot-overlay${exitClass}`} aria-hidden={exit !== "idle" ? "true" : undefined}>
    <FirstLightSurface stage={lastStageRef.current ?? ""} />
  </div>}
</>;
```

`lastStageRef` remembers the last loading stage so the exiting surface keeps its truthful final line. `onExitStart` fires when "landing"/"exiting" begins (once per handoff).

- [ ] **Step 4: Add the overlay, exit, rise, and breath CSS to `loading.css`** (after the "Pre-app loading surface" section):

```css
.boot-overlay { position: fixed; inset: 0; z-index: 90; display: grid; background: #171914; }
.boot-overlay > .loading { height: 100%; }
main.loading::before {
  content: "";
  position: fixed;
  inset: -20%;
  background: radial-gradient(circle at 50% 27%, rgba(168, 241, 91, 0.1), transparent 23rem);
  animation: boot-glow-breath 6s ease-in-out infinite;
  pointer-events: none;
}
@keyframes boot-glow-breath { 0%, 100% { opacity: 0.85; } 50% { opacity: 1; } }

.boot-overlay.boot-exit { animation: boot-exit-night 640ms cubic-bezier(0.2, 0.8, 0.2, 1) both; pointer-events: none; }
.boot-overlay.boot-exit-reduced { animation: boot-exit-fade 150ms linear both; pointer-events: none; }
@keyframes boot-exit-night { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-8px); } }
@keyframes boot-exit-fade { from { opacity: 1; } to { opacity: 0; } }

.workspace.boot-rise { animation: boot-workspace-rise 640ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@keyframes boot-workspace-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
```

Because the radial moves into `main.loading::before`, remove it from the `.loading` background shorthand (~line 384-388), keeping `background: #171914;`. Add `main.loading::before` and `.workspace.boot-rise` to the reduced-motion kill list. Keep `.workspace`'s existing `app-enter` fade for non-handoff mounts (it no longer needs removing — but the `boot-rise` class coexists; if App re-uses `.workspace` alone, `app-enter` still applies, which is today's behavior).

- [ ] **Step 5: Run to verify it passes**

Run: `cd desktop/work-os-companion && npx vitest run src/bootScreen.test.ts src/bootHandoff.render.test.ts src/loadingUi.render.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/BootHandoff.tsx desktop/work-os-companion/src/bootHandoff.render.test.ts desktop/work-os-companion/src/loading.css
git commit -m "feat(companion): boot overlay with Morning Rise handoff"
```

---

### Task 4: Wire the gate chain — persistent overlay, the hold, slim `LoadingScreen`

**Files:**
- Modify: `desktop/work-os-companion/src/App.tsx` (gates at 3758-3783; `bootPhase` ternary ~3740s; `LoadingScreen` non-failed branch 4348-4352; `Wave` import line 66)
- Modify: `test/work-os-desktop-static.test.mts` (assertions 100-103 move to the new files; new seam assertions)

**Interfaces:**
- Consumes: `resolveBootScreen`, `bootRiseClass`, `BOOT_STAGE_COPY` (Task 2); `BootOverlay`, `useBootRise`, `FirstLightSurface` (Task 3).
- Produces: no new exports; the gate chain now resolves through `resolveBootScreen` and renders through `<BootOverlay>`.

- [ ] **Step 1: Update the failing static assertions first** (test-first per surface-guard):

In `test/work-os-desktop-static.test.mts` add near the top reads:
```ts
const boot = read("src/BootHandoff.tsx");
const bootModel = read("src/bootScreen.ts");
```
Then change:
- `assert.match(app, /agent="working" workday="active"/);` → `assert.match(boot, /agent="working" workday="active"/);` (moved with the surface)
- `assert.match(app, /stage="Opening this device/);` → `assert.match(bootModel, /Opening this device’s saved session/);`
- `assert.match(app, /Getting your day ready/);` → `assert.match(boot, /Getting your day ready/);`
- Keep in `app`: `agent="blocked" workday="active"`, `Work OS needs another try`, `>Retry<` (the failed branch stays in App.tsx via `LoadingScreen`).
- Add: `assert.match(app, /resolveBootScreen\(/);`, `assert.match(app, /<BootOverlay/);`, `assert.match(app, /boot-rise/);`, `assert.match(app, /dayReady: !!visibleDay/);`, `assert.match(app, /dayFailed: !!error/);`, `assert.doesNotMatch(app, /loading-wave-large/);`, `assert.match(bootModel, /!state\.dayReady && !state\.dayFailed/);`

Run: `npm run work-os:test` (from repo root, with the v24 Node on PATH) → the static file FAILS on the moved assertions (App.tsx not yet changed).

- [ ] **Step 2: Make the App.tsx changes**

1. Imports: add `import { BootOverlay, useBootRise } from "./BootHandoff";` and `import { BOOT_STAGE_COPY, resolveBootScreen } from "./bootScreen";`
2. Replace the two non-failed `LoadingScreen` returns and the final `return <div className="workspace">` (App.tsx:3758, 3767-3776, 3847-…) with:

```tsx
const boot = resolveBootScreen({
  vault: vaultGate.status === "pending" ? "pending" : vaultGate.status === "failed" ? "failed" : "opened",
  hasSession: !!visibleSession,
  adminReady: landing === "admin" && (!!session || ADMIN_SHELL_BOOT) && workSessionQuery.data?.role === "admin",
  onboarding: visibleOnboarding ? { onboardingRequired: visibleOnboarding.onboardingRequired } : null,
  dayReady: !!visibleDay,
  dayFailed: !!error,
});
const bootRise = useBootRise(boot);

if (boot.kind === "failed") return <LoadingScreen
    failed retry={retryVaultGate} note={vaultGate.failure.message}
    onReset={vaultGate.failure.requiresReset ? startFreshOnThisDevice : undefined}
    onDebug={() => void openDebugger()}
  />;

let bootContent: ReactNode = null;
if (boot.kind === "content") {
  switch (boot.surface) {
    case "connect": bootContent = <ConnectScreen /* existing JSX verbatim */ />; break;
    case "onboarding": bootContent = <Onboarding /* existing JSX verbatim */ />; break;
    case "admin": /* existing admin branch body verbatim, incl. adminNotifications */; bootContent = <AdminWorkspace /* props verbatim */ />; break;
    case "workspace":
      /* every statement that sits between today's admin return and the
         workspace return moves here verbatim; nothing is hoisted out of the
         branch — that preserves today's hook/computation semantics exactly */
      bootContent = <div className={`workspace${bootRise ? " boot-rise" : ""}`}>/* existing JSX verbatim */</div>;
      break;
  }
}
return <BootOverlay screen={boot}>{bootContent}</BootOverlay>;
```

Rules for the mechanical move: no JSX or literal changes inside the moved blocks except the `className` on the workspace `<div>`; every statement stays inside its case (Review Focus 5 + rules-of-hooks parity with today's early returns); the `adminNotifications` construction stays inside the admin case.

3. `LoadingScreen`: delete the non-failed branch (`if (!failed) return <main className="loading">…`, App.tsx:4348-4352) and its now-unused props stay as-is for the failed callers; drop `Wave` from the `./LoadingUi` import at line 66 **only if** no other App.tsx usage remains (grep first — `FadeArc`, `TaskListSkeleton`, `DashboardSkeleton` almost certainly remain).

4. `bootPhase` (~line 3489 region in the worktree): the day hold must keep the phase truthful:

```tsx
: visibleOnboarding.onboardingRequired ? "boot:onboarding"
  : (visibleDay || error) ? "boot:workspace_ready"
    : "boot:waiting_for_data";
```

- [ ] **Step 3: Verify the whole static suite**

Run: `npm run work-os:typecheck && npm run work-os:test`
Expected: typecheck clean; static suite PASS (including companion-acl/mascot guards unchanged).

- [ ] **Step 4: Live smoke via the dev fixtures**

Run the LoadingPreview + the companion dev server; verify with rendered screenshots (design.md §15 evidence, adapted to this surface):
- `?state=loading` shows First Light (no paragraph, bench pulse, oversized stage line gone — spec §2.2).
- `?state=handoff` (Task 5) plays Landing→Rise.
- `?state=failed`, `?state=vault-confirm`, `?state=vault-reset` look unchanged.
Record what rendered (paths/timestamps) for the final report.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/App.tsx test/work-os-desktop-static.test.mts
git commit -m "feat(companion): wire First Light boot handoff into the gate chain"
```

---

### Task 5: Reviewable handoff preview state

**Files:**
- Modify: `desktop/work-os-companion/src/LoadingPreview.tsx`

**Interfaces:**
- Consumes: `BootOverlay`, `useBootRise` (Task 3), `BOOT_STAGE_COPY` (Task 2).
- Produces: `?state=handoff` — a looping review harness (loading 2.2s → content with a stand-in panel → repeat), so the exit is watchable without a packaged app.

- [ ] **Step 1: Implement the harness state**

Add a `HandoffPreview` component: `useState` toggles `screen` between `{ kind: "loading", phase: "day" }` and `{ kind: "content", surface: "workspace" }` on a 2.2s interval; content renders a simple light stand-in panel (`aria-hidden` wireframe div, clearly not the real workspace); wire `useBootRise` the same way App does. The existing states (`loading` now renders `FirstLightSurface` for `BOOT_STAGE_COPY.day`; `connect`, `connecting`, `failed`, `vault-confirm`, `vault-reset` unchanged).

- [ ] **Step 2: Verify by rendering**

Run the preview dev page; capture `loading` and `handoff` frames (the handoff loop must show the landing: pulse completes → night lifts → stand-in panel rises). Screenshot both to the QA record.

- [ ] **Step 3: Commit**

```bash
git add desktop/work-os-companion/src/LoadingPreview.tsx
git commit -m "test(companion): reviewable First Light handoff preview"
```

---

### Task 6: Blueprint and changelog

**Files:**
- Modify: `design.md` (§9.3 gate table row "Opening"; §10 Motion; §13 mascot surfaces)
- Modify: `desktop/work-os-companion/CHANGELOG.md` (`## Unreleased`)

- [ ] **Step 1: design.md edits**

- §9.3 table row for "Opening": "Loading screen: the companion in his working pose, heading, the real stage line, wave, no recovery controls" → "…, the real stage line, the bench pulse, no recovery controls", plus one sentence: the boot overlay is persistent across the vault and day-read phases and exits through the Morning Rise choreography only when the next surface holds real content.
- §10 (Motion): add the handoff contract — landing ≤300ms (accelerated pulse crossing, skipped under reduced motion), exit 640ms `cubic-bezier(.2,.8,.2,1)`, night lifts 8px while the workspace rises 8px, reduced motion = 150ms fade; name the bench pulse + glow breath as the surface's purposeful loops (loading-wait exception to the no-ambient-loops rule).
- §13: in the pre-app loading screen line, "honestly working" stays; add that the loader is the bench of light, not a generic widget.

- [ ] **Step 2: CHANGELOG entry (employee-readable, plain)**

Under `## Unreleased`, one bullet: "The app now opens into a quieter First Light screen — Otto works at a bench of light while your day loads, and your workspace rises into place the moment it's ready."

- [ ] **Step 3: Commit**

```bash
git add design.md desktop/work-os-companion/CHANGELOG.md
git commit -m "docs: blueprint the First Light handoff and note it in the changelog"
```

---

### Task 7: Batch verification and review

**Files:** none created; possible fix-up commits from review findings.

- [ ] **Step 1: Full verification**

```bash
npm run work-os:typecheck
npm run work-os:test
cd desktop/work-os-companion && npx vitest run
```
Expected: all PASS. Any failure is fixed before proceeding (fix commits reference the failing assertion).

- [ ] **Step 2: Rendered QA across the matrix (design.md §15)**

Using the LoadingPreview harness in the companion dev server: wide (~960px), compact (~720px), and a 390px-ish narrow content width; normal + reduced motion; `loading`, `handoff`, and all three recovery states. Exercise the real desktop dev boot once (vault open path) to see the actual handoff into the workspace. Record screenshots + observations; fix anything that reads off (spacing, contrast of the stage line, pulse visibility) as fix-up commits.

- [ ] **Step 3: CodeRabbit batch review (once)**

```bash
coderabbit review --agent --base-commit 8aba3f1d
```
Fix every still-valid finding (security, tenant isolation, data correctness, provenance, state transitions in priority). Rerun only if a fix materially changes the reviewed surface.

- [ ] **Step 4: Final report + converge note**

Report branch/commits, rendered states exercised, remaining gaps. Note for the maintainer: this worktree is companion-authoritative; cross-repo convergence (`scripts/converge-to-agentos.mts`) happens per AGENTS.md after the merge, not in this task.
