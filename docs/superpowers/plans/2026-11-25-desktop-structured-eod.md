# Desktop Structured EOD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended by this repo's AGENTS) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop companion's legacy markdown EOD editor for new drafts with the shared structured composer: prepared suggestions, employee-written sections, a streamed stale-guarded summary, immutable evidence, optional Loom link, serialized autosave, and the same structured brief on submission.

**Architecture:** The server contract already exists. The companion adds a local structured helper module, a thin API module over the existing report routes, a new `EodStructuredComposer` component, and a payload-based branch in `App.tsx`. The legacy `EodComposer` stays for historical drafts and raw recovery. Markdown remains the deterministic record; the structured payload is the composer's source.

**Tech Stack:** React 19 + TypeScript, Tauri 2 companion, Vite, Vitest + `renderToStaticMarkup`, existing `apiRequest`/`apiRequestRaw`/`sendOrQueue` helpers, lucide-react icons. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-desktop-structured-eod-design.md`

## Global Constraints

- New drafts render structured only when `structured_report.version === 1`; historical/no-payload reports always render the legacy editor.
- No new server routes, migrations, Tauri commands, ACL grants, or dependencies.
- Types may be imported type-only from `src/modules/work-os/eod-structured.ts`; runtime helpers are mirrored locally and pinned by a parity test.
- All writes go through `sendOrQueue`; a queued result is never described as delivered.
- Submit is disabled unless all three sections have a line and `eodSummaryIsCurrent` is true.
- Keep the 1000px default / 720px minimum window, the 560px bottom bar, clock-out prompt, draft delete, screenshot gallery, and shift gate.
- Loom is stored and displayed; it is never analyzed in this change.
- Companion app copy is plain employee language; no file names or implementation detail in the UI.

## Review Focus

1. **Keystroke during an in-flight save** — the newest text must survive and a second save must run after the first finishes, not overwrite it with an older snapshot. Tested in Task 3's serialized-save helper test.
2. **Edit after the summary streams** — the summary must become stale and submission must stay disabled until refreshed. Tested in Tasks 1 and 3.
3. **Queued offline submit** — the confirmation must say queued and the payload must carry the idempotency key. Tested in Task 2's payload test and Task 4's handler.
4. **Optimistic save conflict (`409`)** — reload must not silently discard the employee's text. Tested in Task 3's save-result state test and Task 4's handler.
5. **Historical markdown draft** — it must open in the legacy editor, never an empty structured composer. Tested in Task 1's selection test and Task 4's static assertions.

---

## File Structure

- Create `desktop/work-os-companion/src/eodStructured.ts` — type re-exports, pure helpers, payload selection.
- Create `desktop/work-os-companion/src/eodStructured.test.ts` — helper + parity tests.
- Create `desktop/work-os-companion/src/eodStructuredApi.ts` — save/submit/summary/prepare calls and payload builders.
- Create `desktop/work-os-companion/src/eodStructuredApi.test.ts` — payload and stream tests.
- Create `desktop/work-os-companion/src/EodStructuredComposer.tsx` — the composer UI and local state machine.
- Create `desktop/work-os-companion/src/EodStructuredComposer.render.test.ts` — static render states.
- Modify `desktop/work-os-companion/src/App.tsx` — payload branch, handlers, one-time prepare fallback.
- Modify `desktop/work-os-companion/src/workspace-redesign.css` — structured composer layout and responsive rules.
- Modify `desktop/work-os-companion/src/EodPreview.tsx` — dev fixture for the structured composer.
- Modify `test/work-os-desktop-static.test.mts` — static contract assertions.
- Modify `desktop/work-os-companion/CHANGELOG.md` — Unreleased employee note.
- Modify `desktop/work-os-companion/release-queue.json` — one outcome record.

---

### Task 1: Companion structured helpers

**Files:**
- Create: `desktop/work-os-companion/src/eodStructured.ts`
- Test: `desktop/work-os-companion/src/eodStructured.test.ts`

**Interfaces:**
- Consumes: type-only imports from `../../../src/modules/work-os/eod-structured`.
- Produces:
  - `eodCompositionSignature(input: { completed: unknown; inProgress: unknown; next: unknown }): string`
  - `eodCompositionIsComplete(input: Pick<EodStructuredReport, "completed" | "inProgress" | "next">): boolean`
  - `eodSummaryIsCurrent(input: Pick<EodStructuredReport, "summary" | "summarySignature" | "completed" | "inProgress" | "next">): boolean`
  - `normalizeLoomShareUrl(value: unknown): string | null`
  - `eodStructuredFromReport(report: unknown): EodStructuredReport | null`
  - `eodSummaryMode(input: Pick<...> & { writing?: boolean }): "empty" | "ready" | "writing" | "stale" | "done"`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import * as web from "../../../src/modules/work-os/eod-structured";
import {
  eodCompositionIsComplete,
  eodCompositionSignature,
  eodStructuredFromReport,
  eodSummaryIsCurrent,
  eodSummaryMode,
  normalizeLoomShareUrl,
} from "./eodStructured";

const composition = { completed: ["Shipped the handoff"], inProgress: ["Review is open"], next: ["Send the note"] };

describe("companion structured EOD helpers", () => {
  it("selects structured only at version 1", () => {
    expect(eodStructuredFromReport({ structured_report: { version: 1, completed: [], inProgress: [], next: [], suggestions: { completed: [], inProgress: [], next: [] }, evidence: [] } })).not.toBeNull();
    expect(eodStructuredFromReport({ structured_report: { version: 0 } })).toBeNull();
    expect(eodStructuredFromReport({ markdown: "# legacy" })).toBeNull();
    expect(eodStructuredFromReport(null)).toBeNull();
  });

  it("keeps the summary current only for the exact composition", () => {
    const signature = eodCompositionSignature(composition);
    expect(eodSummaryIsCurrent({ ...composition, summary: "A finished day.", summarySignature: signature })).toBe(true);
    expect(eodSummaryIsCurrent({ ...composition, summary: "A finished day.", summarySignature: "stale" })).toBe(false);
    expect(eodCompositionIsComplete({ ...composition, completed: [] })).toBe(false);
  });

  it("reports summary modes in the order the composer uses", () => {
    expect(eodSummaryMode({ completed: [], inProgress: [], next: [], summary: "", summarySignature: null })).toBe("empty");
    expect(eodSummaryMode({ ...composition, summary: "", summarySignature: null })).toBe("ready");
    expect(eodSummaryMode({ ...composition, summary: "", summarySignature: null, writing: true })).toBe("writing");
    expect(eodSummaryMode({ ...composition, summary: "Stale", summarySignature: "old" })).toBe("stale");
    expect(eodSummaryMode({ ...composition, summary: "Current", summarySignature: eodCompositionSignature(composition) })).toBe("done");
  });

  it("matches the web normalization and signature exactly", () => {
    for (const value of ["loom.com/share/0123456789abcdef0123456789abcdef", "https://www.loom.com/share/0123456789ABCDEF0123456789ABCDEF", "https://example.com/share/0123456789abcdef0123456789abcdef", "not a url"]) {
      expect(normalizeLoomShareUrl(value)).toBe(web.normalizeLoomShareUrl(value));
    }
    expect(eodCompositionSignature(composition)).toBe(web.eodCompositionSignature(composition));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop/work-os-companion && npm test -- src/eodStructured.test.ts`
Expected: FAIL because `./eodStructured` does not exist.

- [ ] **Step 3: Implement the helper module**

Re-export the shared types with `export type { ... } from "../../../src/modules/work-os/eod-structured"`. Copy the four pure helpers from the shared module verbatim (signature, complete, current, Loom normalization). Implement `eodStructuredFromReport` to return `null` unless the record is an object with `structured_report.version === web.EOD_STRUCTURED_VERSION`; otherwise return `web.normalizeEodStructuredReport(report.structured_report)` at runtime? That is a runtime import from `src/`; do not use it. Instead, call the local copies and return the typed record after validating `version`, `completed`, `inProgress`, `next`, `summary`, `summarySignature`, `suggestions`, `evidence`, `loomUrl`. Import `EOD_STRUCTURED_VERSION` as a type-only? Constants are runtime values; duplicate the literal `1` with a named local `EOD_STRUCTURED_VERSION = 1` and pin it in the parity test. `eodSummaryMode` checks `writing`, then summary/current, then complete.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd desktop/work-os-companion && npm test -- src/eodStructured.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/eodStructured.ts desktop/work-os-companion/src/eodStructured.test.ts
git commit -m "feat(companion): add structured EOD helpers"
```

---

### Task 2: Companion API calls and payload builders

**Files:**
- Create: `desktop/work-os-companion/src/eodStructuredApi.ts`
- Test: `desktop/work-os-companion/src/eodStructuredApi.test.ts`

**Interfaces:**
- Consumes: `apiRequestRaw`, `sendOrQueue` from `./api`; `EodCompositionInput`.
- Produces:
  - `eodSavePayload(input: EodCompositionInput): Record<string, unknown>`
  - `eodSubmitPayload(input: EodCompositionInput, key: string): Record<string, unknown>`
  - `prepareStructuredEod(date: string): Promise<{ report: Record<string, unknown> }>`
  - `saveStructuredEod(reportId: string, input: EodCompositionInput): Promise<{ report?: Record<string, unknown>; queued?: true }>`
  - `submitStructuredEod(reportId: string, input: EodCompositionInput, key: string): Promise<{ report?: Record<string, unknown>; queued?: true }>`
  - `streamEodSummary(input: EodCompositionInput, onChunk: (text: string) => void, signal: AbortSignal): Promise<{ source: "otto" | "assembled" }>`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequestRaw, sendOrQueue } from "./api";
import { eodSavePayload, eodSubmitPayload, streamEodSummary, submitStructuredEod } from "./eodStructuredApi";

vi.mock("./api", () => ({
  apiRequestRaw: vi.fn(),
  sendOrQueue: vi.fn(),
}));

const input = { completed: ["Shipped"], inProgress: ["Review"], next: ["Send"], summary: "Done.", summaryGeneratedAt: "2026-11-25T17:00:00.000Z", summarySource: "otto" as const, summarySignature: "abc", loomUrl: "https://www.loom.com/share/0123456789abcdef0123456789abcdef" };

afterEach(() => vi.clearAllMocks());

describe("companion structured EOD API", () => {
  it("builds the save and submit payloads the web uses", () => {
    expect(eodSavePayload(input)).toEqual(input);
    expect(eodSubmitPayload(input, "key-1")).toEqual({ structured: input, submission_idempotency_key: "key-1" });
  });

  it("streams summary chunks and reports the source", async () => {
    vi.mocked(apiRequestRaw).mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("A day "));
        controller.enqueue(new TextEncoder().encode("of work."));
        controller.close();
      },
    }), { headers: { "X-Work-OS-Summary-Source": "otto" } }));
    const chunks: string[] = [];
    const result = await streamEodSummary(input, (chunk) => chunks.push(chunk), new AbortController().signal);
    expect(chunks.join("")).toBe("A day of work.");
    expect(result.source).toBe("otto");
  });

  it("passes a queued submit through unchanged", async () => {
    vi.mocked(sendOrQueue).mockResolvedValue({ queued: true });
    await expect(submitStructuredEod("r-1", input, "key-1")).resolves.toEqual({ queued: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop/work-os-companion && npm test -- src/eodStructuredApi.test.ts`
Expected: FAIL because `./eodStructuredApi` does not exist.

- [ ] **Step 3: Implement the module**

`eodSavePayload` returns the seven composition fields. `eodSubmitPayload` returns `{ structured: input, submission_idempotency_key: key }`. `prepareStructuredEod` posts `{ date }` to `/api/work-os/me/eod/prepare` with `apiRequest` (import it too) and returns the body. `saveStructuredEod` calls `sendOrQueue(`/api/work-os/reports/${encodeURIComponent(reportId)}`, "PATCH", eodSavePayload(input))` and casts the result. `submitStructuredEod` calls `sendOrQueue(..., "PATCH", eodSubmitPayload(input, key))`. `streamEodSummary` calls `apiRequestRaw("/api/work-os/me/eod/summary", { method: "POST", body: JSON.stringify(input), signal }, { timeoutMs: 60_000 })`; on `!response.ok` read `response.text()` and throw the server message; read the `X-Work-OS-Summary-Source` header (`otto` or `assembled`); if no body throw; read with `getReader()`, decode each chunk, and call `onChunk` with the decoded text.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd desktop/work-os-companion && npm test -- src/eodStructuredApi.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/eodStructuredApi.ts desktop/work-os-companion/src/eodStructuredApi.test.ts
git commit -m "feat(companion): add structured EOD API calls"
```

---

### Task 3: `EodStructuredComposer` component

**Files:**
- Create: `desktop/work-os-companion/src/EodStructuredComposer.tsx`
- Test: `desktop/work-os-companion/src/EodStructuredComposer.render.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers, `EodShiftOpenNotice` if the shift prompt is needed, `EodScreenshotPanel` via the `screenshots` node from the caller.
- Produces:

```ts
export type EodStructuredSaveResult = "saved" | "queued";
export type EodStructuredComposerProps = {
  reportId: string;
  structured: EodStructuredReport;
  dayLabel?: string;
  clockedOut?: boolean;
  shiftOpen?: boolean;
  loomEnabled?: boolean;
  summaryStreaming?: boolean;
  screenshots?: React.ReactNode;
  onOpenDashboard?: () => void;
  onSave: (input: EodCompositionInput) => Promise<EodStructuredSaveResult>;
  onWriteSummary: (input: EodCompositionInput, onChunk: (text: string) => void, signal: AbortSignal) => Promise<{ source: "otto" | "assembled" }>;
  onSubmit: (input: EodCompositionInput, idempotencyKey: string) => Promise<EodStructuredSaveResult>;
  onRedraft: () => void;
  onDelete?: () => void;
};
```

- [ ] **Step 1: Write the failing render tests**

```tsx
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EodStructuredComposer } from "./EodStructuredComposer";

const structured = { version: 1, summary: "", summaryGeneratedAt: null, summarySource: null, summarySignature: null, completed: [], inProgress: [], next: [], suggestions: { completed: ["Reconcile September settlements"], inProgress: ["Companion approvals"], next: ["Update the checklist"] }, evidence: [{ source: "tasks", label: "Tasks", items: [{ id: "t1", title: "Reconcile September settlements", summary: null, meta: "Payments · 3:30 PM", url: null, at: "2026-11-25T15:30:00.000Z", kind: "completed" }] }], loomUrl: null, preparedAt: "2026-11-25T16:50:00.000Z", source: "scheduled" };
const base = { reportId: "r-1", structured, onSave: async () => "saved" as const, onWriteSummary: async () => ({ source: "otto" as const }), onSubmit: async () => "saved" as const, onRedraft: () => undefined, onDelete: () => undefined };

describe("EodStructuredComposer", () => {
  it("shows the three sections and waits on entries", () => {
    const markup = renderToStaticMarkup(createElement(EodStructuredComposer, base));
    expect(markup).toContain("Completed");
    expect(markup).toContain("In progress");
    expect(markup).toContain("Next");
    expect(markup).toContain("Waiting on your entries");
    expect(markup).toContain("Submit for review");
    expect(markup).toMatch(/disabled/);
  });

  it("asks for a current summary before submitting", () => {
    const markup = renderToStaticMarkup(createElement(EodStructuredComposer, {
      ...base,
      structured: { ...structured, completed: ["Shipped the handoff"], inProgress: ["Review is open"], next: ["Send the note"] },
    }));
    expect(markup).toContain("Ready to write");
    expect(markup).toContain("Write the summary");
    expect(markup).toContain("Write the summary before submitting.");
  });

  it("renders stale, immutable evidence and an attached Loom", () => {
    const markup = renderToStaticMarkup(createElement(EodStructuredComposer, {
      ...base,
      structured: { ...structured, completed: ["Shipped"], inProgress: ["Review"], next: ["Send"], summary: "A finished day.", summarySignature: "old", loomUrl: "https://www.loom.com/share/0123456789abcdef0123456789abcdef" },
    }));
    expect(markup).toContain("Refresh summary");
    expect(markup).toContain("Recorded evidence");
    expect(markup).toContain("Immutable");
    expect(markup).toContain("Loom");
    expect(markup).toContain("Submit for review");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd desktop/work-os-companion && npm test -- src/EodStructuredComposer.render.test.ts`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component**

Keep local `completed`, `inProgress`, `next`, `summary`, `summarySignature`, `summarySource`, `loomUrl` state initialised from `structured`. Suggestion paging uses two pills per page and hides consumed lines case-insensitively. Autosave debounces 700ms and serialises through refs (`saveInFlight`, `saveQueued`, `dirty`): a save that finishes while the buffer changed schedules exactly one follow-up with the latest snapshot. `onSave` returning `"queued"` shows the honest queued copy. `onWriteSummary` is called with an `AbortController`; chunks append to the summary; on completion set `summarySignature = eodCompositionSignature(current)` and `summarySource`. `eodSummaryMode` drives the summary card and footer reason. Submit calls `onSubmit(input, crypto.randomUUID())` only when complete and current. Loom uses `normalizeLoomShareUrl`; invalid input keeps Attach disabled. Evidence is read-only and grouped by source: the first source opens by default, only one panel renders at a time, and clicking the open source collapses it. Every line row ends with a trash action. Render `screenshots` after evidence. Use `EodStructuredComposer` classes listed in Task 5.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd desktop/work-os-companion && npm test -- src/EodStructuredComposer.render.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/EodStructuredComposer.tsx desktop/work-os-companion/src/EodStructuredComposer.render.test.ts
git commit -m "feat(companion): add structured EOD composer"
```

---

### Task 4: App integration and prepared fallback

**Files:**
- Modify: `desktop/work-os-companion/src/App.tsx` (imports, review branch around line 6395, handlers after `submitEod`)
- Modify: `test/work-os-desktop-static.test.mts`
- Test: `cd desktop/work-os-companion && npm test -- src/eodStructured.test.ts` (selection helper) and the static suite.

**Interfaces:**
- Consumes: Task 1 `eodStructuredFromReport`, Task 2 API calls, Task 3 component.
- Produces: the Review view chooses structured when `eodStructuredFromReport(reviewDay?.report)` is non-null; handlers named `saveStructuredComposition`, `writeStructuredSummary`, `submitStructuredComposition`.

- [ ] **Step 1: Write the failing static assertions**

In `test/work-os-desktop-static.test.mts`, add:

```ts
assert.match(app, /EodStructuredComposer/, "the Review view renders the structured composer");
assert.match(app, /eodStructuredFromReport/, "the structured composer is selected by payload, not build");
assert.match(app, /saveStructuredEod/, "structured autosave uses the report route");
assert.match(app, /submitStructuredEod/, "structured submit uses the submit route");
assert.match(app, /streamEodSummary/, "the summary streams through the API helper");
```

Run: `node --import tsx --test test/work-os-desktop-static.test.mts`
Expected: FAIL on the new assertions.

- [ ] **Step 2: Implement the branch and handlers**

In `App.tsx`:

```tsx
const structuredReview = eodStructuredFromReport(reviewDay?.report);

async function saveStructuredComposition(input: EodCompositionInput) {
  const reportId = String(reviewDay?.report?.id ?? "");
  if (!reportId) throw new Error("The report is not ready to save.");
  const result = await saveStructuredEod(reportId, input);
  if (result.queued) return "queued" as const;
  if (result.report) applyReportToDay(eodDate, result.report as NonNullable<DayData["report"]>);
  return "saved" as const;
}

async function writeStructuredSummary(input: EodCompositionInput, onChunk: (text: string) => void, signal: AbortSignal) {
  return streamEodSummary(input, onChunk, signal);
}

async function submitStructuredComposition(input: EodCompositionInput, idempotencyKey: string) {
  const reportId = String(reviewDay?.report?.id ?? "");
  if (!reportId) throw new Error("The report is not ready to submit.");
  const result = await submitStructuredEod(reportId, input, idempotencyKey);
  const queued = result.queued === true;
  setEodQueued(queued);
  setEodSubmitted(true);
  invalidateOutstandingEods();
  if (eodDate) void queryClient.invalidateQueries({ queryKey: workOsKeys.reportDay(eodDate) });
  return queued ? "queued" as const : "saved" as const;
}
```

Replace the composer branch with:

```tsx
{structuredReview ? <EodStructuredComposer
  key={`${reviewDay.report.id}:${String(reviewDay.report.prepared_at ?? "")}`}
  reportId={String(reviewDay.report.id)}
  structured={structuredReview}
  dayLabel={eodDate ? formatWorkOsDate(eodDate) : "today"}
  clockedOut={eodClockedOut}
  shiftOpen={reviewShiftOpen}
  loomEnabled={visibleDay?.access?.featureFlags?.loom_updates === true}
  onOpenDashboard={() => setView("day")}
  onSave={saveStructuredComposition}
  onWriteSummary={writeStructuredSummary}
  onSubmit={submitStructuredComposition}
  onRedraft={() => void redraftEod(reviewDay)}
  onDelete={["draft", "rejected"].includes(String(reviewDay.report.status)) && !reviewDay.report.submitted_at ? () => setEodDeleteConfirmation(true) : undefined}
  screenshots={null}
/> : <EodComposer ...existing props />}
```

Add the one-time fallback after the review data is available:

```tsx
const preparedReviewDates = useRef(new Set<string>());
useEffect(() => {
  const report = reviewDay?.report;
  if (view !== "review" || !report || eodLanding || eodDate) return;
  if (eodStructuredFromReport(report)) return;
  if (!["draft", "rejected"].includes(String(report.status))) return;
  const date = String(report.report_date ?? reviewDay?.shiftDate ?? "");
  if (!date || date !== visibleDay?.shiftDate) return;
  if (preparedReviewDates.current.has(date)) return;
  preparedReviewDates.current.add(date);
  void prepareStructuredEod(date).then((result) => {
    if (result.report) applyReportToDay(null, result.report as NonNullable<DayData["report"]>);
  }).catch(() => undefined);
}, [view, reviewDay, eodLanding, eodDate, visibleDay?.shiftDate]);
```

Import `EodStructuredComposer`, `eodStructuredFromReport`, `saveStructuredEod`, `submitStructuredEod`, `streamEodSummary`, and `prepareStructuredEod`. Do not alter the existing markdown `submitEod` path.

- [ ] **Step 3: Run the static test**

Run: `node --import tsx --test test/work-os-desktop-static.test.mts`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `npm run work-os:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/App.tsx test/work-os-desktop-static.test.mts
git commit -m "feat(companion): use the structured EOD composer for new drafts"
```

---

### Task 5: Layout, preview fixture, and rendered checks

**Files:**
- Modify: `desktop/work-os-companion/src/workspace-redesign.css`
- Modify: `desktop/work-os-companion/src/EodPreview.tsx`

- [ ] **Step 1: Add the styles**

Add `.eod-structured` styles beside `.eod-composer` in `workspace-redesign.css`. Use the existing token roles. Required classes: `.eod-structured`, `.eod-structured-head`, `.eod-structured-summary`, `.eod-structured-sections`, `.eod-structured-section`, `.eod-structured-label`, `.eod-structured-lines`, `.eod-structured-line`, `.eod-structured-suggest`, `.eod-structured-pills`, `.eod-structured-loom`, `.eod-structured-evidence`, `.eod-structured-footer`, `.eod-structured-save`. At `max-width: 820px` stack the label above the field. At `max-width: 700px` make pills a horizontal snap rail and stack the footer reason. Keep 40px targets, visible focus, and reduced-motion behavior inherited from the app.

- [ ] **Step 2: Add the dev fixture**

In `EodPreview.tsx`, add a structured branch selected by `params.get("preview-eod") === "structured"`. Render `EodStructuredComposer` with a fixture containing: a prepared summary, three sections, suggestions, two evidence groups, and an attached Loom. Stub `onSave` to `"saved"`, `onWriteSummary` to append the fixture paragraph through `onChunk`, `onSubmit` to `"saved"`, and `onRedraft`/`onDelete` to no-ops. Leave the existing legacy preview unchanged for any other value.

- [ ] **Step 3: Run the preview and check rendered states**

Run: `cd desktop/work-os-companion && npm run dev`
Expected: Vite serves the companion. Open `http://localhost:5173/?preview-eod=structured` and verify:
- 1000px and 720px: no horizontal overflow; section label/field grid stacks at 720px.
- 560px: bottom bar visible, footer reachable, pills scroll horizontally.
- Summary states: waiting, ready, writing, stale, current.
- Evidence source switch and Loom card render.
- Keyboard focus is visible on fields, pills, summary action, and submit.

- [ ] **Step 4: Commit**

```bash
git add desktop/work-os-companion/src/workspace-redesign.css desktop/work-os-companion/src/EodPreview.tsx
git commit -m "feat(companion): style and preview the structured EOD"
```

---

### Task 6: Release note, queue, and full verification

**Files:**
- Modify: `desktop/work-os-companion/CHANGELOG.md`
- Modify: `desktop/work-os-companion/release-queue.json`

- [ ] **Step 1: Add the employee note**

Under `## Unreleased`, add one plain bullet: “Write your end-of-day report from suggested work, then let Otto draft the summary; the desktop now matches the web.”

- [ ] **Step 2: Append the release-queue record**

Add one record with `id: "desktop-structured-eod"`, `type: "feature"`, the same summary, and verification naming the commit and the commands below. Do not remove or rewrite existing records.

- [ ] **Step 3: Verify the release queue**

Run: `npm run companion:release:status`
Expected: the new record is counted; no version bump is prepared below five outcomes.

- [ ] **Step 4: Run the focused and full checks**

```bash
cd desktop/work-os-companion && npm test
cd ../.. && npm run work-os:typecheck
cd desktop/work-os-companion && npx eslint src/EodStructuredComposer.tsx src/eodStructured.ts src/eodStructuredApi.ts src/App.tsx
cd ../.. && npm run work-os:test
```

Expected: companion tests pass; typecheck passes; lint has no errors; the full Work OS suite passes (the 11 PostgreSQL tests may skip without a disposable database).

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/CHANGELOG.md desktop/work-os-companion/release-queue.json
git commit -m "docs(companion): record the structured EOD outcome"
```

---

### Task 7: Refined submitted reading view (employee, admin, preview)

**Files:**
- Create: `desktop/work-os-companion/src/EodStructuredReadingView.tsx`
- Test: `desktop/work-os-companion/src/EodStructuredReadingView.render.test.ts`
- Modify: `desktop/work-os-companion/src/EodSubmittedReport.tsx` and its render test
- Modify: `desktop/work-os-companion/src/App.tsx` (pass the report row)
- Modify: `desktop/work-os-companion/src/admin/types.ts`, `admin/data.ts`, `admin/ReviewPage.tsx`
- Modify: `desktop/work-os-companion/src/EodPreview.tsx` (submitted preview state)
- Modify: `desktop/work-os-companion/src/workspace-redesign.css`
- Modify: `test/work-os-desktop-static.test.mts`

**Interfaces:**
- `EodStructuredReadingView({ report, variant = "admin", personName, date, status })` renders the read-only structured brief.
- `EodSubmittedReport` accepts `report?: Record<string, unknown> | null` and chooses the structured view when `eodStructuredFromReport(report)` is non-null.
- `WorkOsReportRow` gains `structured_report?: unknown` and `loom_url?: string | null`; `normalizeReports` maps both.

- [ ] **Step 1: Write the failing reading-view test**

Render `EodStructuredReadingView` with the fixture; assert the summary owner, Completed / In progress / Next, the Loom card, the first evidence panel, and no input/textarea. Add an admin variant assertion for “the employee’s entries”.

- [ ] **Step 2: Implement the reading view**

Port the web `EodStructuredView` hierarchy: summary card, three-row sections card with counts and bullet lines, Loom card, evidence source accordion (first open, one open at a time), and an optional `fullRecord` slot. Read-only. Use the companion tokens and new `.eod-reading-*` classes.

- [ ] **Step 3: Integrate the employee submitted view**

When `EodSubmittedReport` receives a structured payload, render `EodStructuredReadingView` and a `<details>` “Full recorded day” containing `EodReportDocument`. Keep the existing parsed markdown/plain-text fallback for legacy reports.

- [ ] **Step 4: Integrate the admin review**

Add `structured_report`/`loom_url` to the admin row type and normalizer. In `ReportBody`, render the reading view when structured, then the existing appendix, sourced evidence, recaps and raw-text disclosures. Keep the parsed sections fallback.

- [ ] **Step 5: Preview the submitted state**

In the structured preview, a Submit click switches to `EodSubmittedReport` with the same fixture and markdown, so the preview shows compose → submitted reading view. “All EODs” returns to compose.

- [ ] **Step 6: Verify**

Run the reading, submitted-report, companion and static suites; `npm run work-os:typecheck`; render the structured preview at 1000, 720 and 560 in light and dark; confirm no edit controls and no horizontal overflow.

## Self-Review

- **Spec coverage:** The design's goals map to Tasks 1–6. The replace/legacy split is Task 1's selector and Task 4's branch. Server-prepared fallback is Task 4. The stale gate is Tasks 1 and 3. Offline/idempotency is Tasks 2 and 4. Desktop surfaces are Task 5. Release accounting is Task 6.
- **Step scan:** Each task has a failing test, an implementation step, a passing test, and a commit. The only non-code step is the rendered check in Task 5, which names the URLs and widths.
- **Type consistency:** `EodCompositionInput`, `EodStructuredReport`, `EodStructuredSaveResult`, `streamEodSummary`, and the handler names are used consistently across tasks.
- **Review focus:** Each of the five failure modes has a test in its owning task.
- **Proportion:** The plan names interfaces and test assertions; it does not transcribe the component body.
