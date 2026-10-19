# Recap Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employee press **Listen** on a recap and hear Otto read the recap's own lines while a teleprompter slides those same lines in sync, with Otto visibly talking and a distinct reading waveform on the bubble and the composer mic.

**Architecture:** A new server route (`POST /api/work-os/voice/recap`) loads the stored recap, assembles the spoken lines from the recap's own fields, synthesises them with Google Gemini 3.8 Flash TTS on fal (the same account and `FAL_API_KEY` the transcriber already uses), and returns the WAV bytes plus the lines it spoke in response headers (with an in-process LRU keyed `intervalId:revision:voice`). The companion owns one audio element: it fetches a clip on press, drives a teleprompter from `audio.currentTime / audio.duration` with per-line weights, grows the collapsed window while reading, animates Otto's mouth, and shows a cream "Otto is reading" waveform on the bubble and the mic chip.

**Tech Stack:** Next.js 16 route handlers (Node runtime), Tauri 2 + React 19 + Vite (companion), vitest (companion), `node --test` with `tsx` (server libs), fal.ai `google/gemini-3.8-flash-tts`, ffmpeg (one-off sample transcoding, local only).

**Spec:** `docs/superpowers/specs/2026-10-16-recap-voice-design.md` (read it with this plan).

## Global Constraints

- The spoken lines are **exactly** the recap's own words: the `detail` lead line first, then each `activities[]` entry's text with its clock time split out. Never the workflow chips, evidence counts, screenshots, gap notes, or recorded GitHub activity. No invented glue words, no re-phrasing, no added times.
- `FAL_API_KEY` stays server-only. Never sent to the client, never logged, never in an error message.
- The feature is gated by the existing `voice_input` flag (`requireWorkOsAccess({ feature: "voice_input" })`). The UI label becomes **“Voice input & output”**; the flag key does not change.
- The route takes the recap's **id**, never arbitrary client text (a text-taking route would be an open, billed TTS proxy).
- Cache key is `(intervalId, revision, voice)`; a clip must never speak a revision the card is not showing.
- Recording and playback are mutually exclusive; exactly one audio element exists per companion window.
- Reduced motion (`prefersReducedMotion()`, `src/listShift.ts`) steps the prompter line-by-line; nothing slides.
- Failure copy follows the transcriber's rule (`src/lib/aiTranscribe.ts`): bounded, no provider payloads, no status codes, always a route back.
- Companion copy is sentence case, plain verbs; the control is named **Listen** everywhere and stopping is named **Stop**.
- Do not change `MASCOT_POSES` (`src/mascotTypes.ts`); the speaking treatment is a separate `speaking` flag so the mascot guard tests (`test/work-os-companion-mascot.test.mts`) keep passing.
- Everything runs in this worktree (`/home/maigreeks/projects/.worktrees/recap-voice`, branch `codex/recap-voice`); commit each task on its own.

## Review Focus

1. **A recap with nothing to say** (generation failed, `detail` null and `activities` empty): the Listen control must not appear — never a button that plays silence or a provider error.
2. **A very long recap** (12 activities × up to 300 characters): the script must either read it all or refuse with the `too_long` copy; never a request that bills an unbounded string. Cap: 6,000 characters.
3. **The provider answering slowly, out of credit, or not at all**: the control returns to idle with the bounded copy and stays retryable; no stuck spinner, no audio element left behind.
4. **A large text size or small mascot size** (both accessibility settings): the grown bubble must still fit the monitor (clamped) and the prompter must stay readable; the mascot must not move.
5. **Playback interrupted** (window hidden from the tray, app quit, expanding the companion, or the employee starting a recording): audio stops, state resets, no orphan audio, and expanding does **not** stop the read.

## File Structure

**Server**
- Create `src/lib/work-os-recap-speech.ts` — voice set, script assembly, fal call, LRU cache, failure mapping.
- Create `src/app/api/work-os/voice/recap/route.ts` — auth, body validation, interval load, response (WAV bytes + line headers).
- Modify `src/lib/work-os-activity-intervals.ts` — `revision` on the view, a single-interval reader, the tightened synthesis prompt.
- Modify `src/lib/work-os-readiness.ts` — the `fal_key_missing` copy mentions both directions.
- Modify `src/modules/work-os/admin/AdminSettings.tsx` — label “Voice input & output”.
- Create `test/work-os-recap-speech.test.mts` — script assembly, provider call, cache.
- Create `test/work-os-recap-route.test.mts` — the route's auth/validation/failure contract (calls the handler with a stubbed provider).

**Companion** (`desktop/work-os-companion/`)
- Create `src/recapSpeech.ts` — voice options, settings normalisation, prompter math, growth math (pure).
- Create `src/recapSpeech.test.ts`.
- Create `src/useRecapSpeech.ts` — the single playback controller.
- Create `src/RecapPrompter.tsx` — the sliding window.
- Modify `src/api.ts` — `apiRequestAudio(path, init)` returning bytes + the recap headers.
- Modify `src/AvatarApp.tsx` — Listen pill, prompter state, grown window, mic chip, mutual exclusion.
- Modify `src/ActivityIntervalCard.tsx` — Listen beside the ✓/✎ row.
- Modify `src/MascotPet.tsx`, `src/StudioOtto.tsx`, `src/mascotTypes.ts` — a `speaking` flag and its mouth animation.
- Create `src/VoicePicker.tsx` + modify `src/App.tsx` (settings group) and `src/vault.ts` (settings field).
- Create `public/voices/*.mp3` (shipped samples) + modify `src/AvatarPreview.tsx` (fixtures).

---

### Task 1: The spoken lines, from the recap's own fields

**Files:**
- Create: `src/lib/work-os-recap-speech.ts`
- Test: `test/work-os-recap-speech.test.mts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RECAP_SPEECH_MAX_CHARS = 6000`; `type RecapSpeechLine = { text: string; time: string | null }`; `buildRecapSpeechLines(interval: { detail?: string | null; headline?: string | null; activities?: unknown }): RecapSpeechLine[]` — the detail first (time `null`), then each activity split by the existing `splitActivityTime` rule (import from `@/lib/activity-time` — see Step 3), skipping empties.

- [ ] **Step 1: Write the failing test**

```ts
// test/work-os-recap-speech.test.mts
test("speaks the lead line then each activity in order", () => {
  const lines = buildRecapSpeechLines({
    detail: "Software-development review across three repositories.",
    activities: ["7:21 PM Reviewed the cursor-pagination code", "Read the blocker notes"],
  });
  assert.deepEqual(lines, [
    { text: "Software-development review across three repositories.", time: null },
    { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
    { text: "Read the blocker notes", time: null },
  ]);
});
test("an empty recap produces no lines at all", () => {
  assert.deepEqual(buildRecapSpeechLines({ detail: null, activities: [] }), []);
  assert.deepEqual(buildRecapSpeechLines({ detail: "   ", headline: "Ready" }), []);
});
test("an old recap whose time trails the phrase keeps the line intact", () => {
  const [line] = buildRecapSpeechLines({ activities: ["Reviewed the task list at 7:38 PM"] });
  assert.deepEqual(line, { text: "Reviewed the task list at 7:38 PM", time: null });
});
test("a script past the cap is refused, not trimmed", () => {
  const activities = Array.from({ length: 12 }, (_, index) => `${"x".repeat(300)} ${index}`);
  assert.throws(() => buildRecapSpeechLines({ detail: "Lead", activities }), /too long to read aloud/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test test/work-os-recap-speech.test.mts`
Expected: FAIL — `buildRecapSpeechLines is not a function`.

- [ ] **Step 3: Extract the clock-time splitter so both apps share one rule**

Move the body of `splitActivityTime` out of `desktop/work-os-companion/src/ActivityIntervalCard.tsx` into a new server-side module `src/lib/activity-time.ts` (`export function splitActivityTime(activity: string): { time: string | null; text: string }`), re-export it from `ActivityIntervalCard.tsx` (`export { splitActivityTime } from "@/lib/activity-time"` is **not** possible across the app boundary — instead keep the companion's copy importing nothing, and have the new module hold the canonical regex; add a test in `test/work-os-recap-speech.test.mts` asserting both files contain the same regex source so the rule cannot drift silently).

- [ ] **Step 4: Implement `buildRecapSpeechLines`**

Signature as above. Rules: `detail` trimmed, dropped when empty; each `activities` entry must be a string, trimmed, dropped when empty; split with `splitActivityTime`; keep only `.text` (times are the card's pills, not spoken); when `detail` is absent, start with `headline`; if the joined text exceeds `RECAP_SPEECH_MAX_CHARS`, `throw new Error("This recap is too long to read aloud.")`.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `node --import tsx --test test/work-os-recap-speech.test.mts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/work-os-recap-speech.ts src/lib/activity-time.ts test/work-os-recap-speech.test.mts
git commit -m "feat(work-os): assemble the spoken lines from a recap"
```

---

### Task 2: The revision the card rendered

**Files:**
- Modify: `src/lib/work-os-activity-intervals.ts` (view type ~line 904, `intervalView` ~line 1016, new reader near `activityIntervalFullView` ~line 1045)
- Modify: `desktop/work-os-companion/src/types.ts` (`ActivityInterval`, ~line 419)
- Test: `test/work-os-activity-intervals-revision.test.mts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ActivityIntervalView.revision: number` (1 when the column is null); `getActivityIntervalForPerson(access: WorkOsAccess, intervalId: string): Promise<ActivityIntervalRecord | null>` scoped by `organization_id` and `person_id`; the companion's `ActivityInterval.revision?: number`.

- [ ] **Step 1: Write the failing test** — rows with `revision: 3`, `revision: null`, and an interval owned by another person; assert `intervalView` reports `3` and `1`, and that the reader returns `null` for the other person's interval and for an unknown id.

- [ ] **Step 2: Run it and watch it fail** — `node --import tsx --test test/work-os-activity-intervals-revision.test.mts` → FAIL (`revision` undefined).

- [ ] **Step 3: Implement** — add `revision: Math.max(1, Math.floor(Number(row.revision) || 1))` to `intervalView`; add the reader using `db().from("work_activity_intervals").select("*").eq("id", intervalId).eq("organization_id", access.organizationId).eq("person_id", access.personId).maybeSingle()` and throw a labelled error on a query error; add `revision?: number` to the companion type with a comment that older payloads omit it.

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit** — `feat(work-os): expose a recap's revision to clients`.

---

### Task 3: Speaking the lines, once per (recap, revision, voice)

**Files:**
- Modify: `src/lib/work-os-recap-speech.ts`
- Test: `test/work-os-recap-speech.test.mts`

**Interfaces:**
- Consumes: Task 1's `RecapSpeechLine`.
- Produces: `RECAP_VOICES: readonly string[]` (the shipped set, Task 13 fills it); `DEFAULT_RECAP_VOICE`; `recapSpeechConfigured(): boolean`; `type RecapSpeechFailure = "not_configured" | "too_long" | "provider_error" | "timeout" | "malformed"`; `type RecapSpeechResult = { ok: true; audio: Uint8Array; mimeType: string; voice: string } | { ok: false; reason: RecapSpeechFailure }`; `synthesizeRecapSpeech(input: { lines: RecapSpeechLine[]; voice: string; fetchImpl?: typeof fetch }): Promise<RecapSpeechResult>`; `speakRecap(input: { intervalId: string; revision: number; voice: string; lines: RecapSpeechLine[] }): Promise<RecapSpeechResult>` (LRU, 32 entries, key `${intervalId}:${revision}:${voice}`).

- [ ] **Step 1: Write the failing tests** — with a stub `fetchImpl`:
  - the request goes to `https://fal.run/google/gemini-3.8-flash-tts` with header `Authorization: Key <FAL_API_KEY>`, body `prompt` = the lines joined by a full stop + space, `voice`, and a non-empty `style_instructions`;
  - a 200 with a URL body fetches the bytes and answers `ok: true` with `mimeType: "audio/wav"`;
  - 402 → `provider_error`; a thrown `TimeoutError` → `timeout`; a 200 with no URL → `malformed`; missing `FAL_API_KEY` → `not_configured`;
  - two `speakRecap` calls for the same (id, revision, voice) call the provider **once**; a different revision calls it again.

- [ ] **Step 2: Run and watch fail** → FAIL (module has no `synthesizeRecapSpeech`).

- [ ] **Step 3: Implement** — mirror `src/lib/aiTranscribe.ts`: 25s `AbortSignal.timeout`, `cache: "no-store"`, response body `{ audio?: { url?: string } }`, then `fetch(url)` for bytes; `STYLE_INSTRUCTIONS = "Warm, unhurried, conversational; a colleague catching you up, not a narrator. Short pauses between lines."`; a module-level `Map` LRU trimmed to 32 by insertion order.

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit** — `feat(work-os): synthesise recap speech with fal`.

---

### Task 4: The route

**Files:**
- Create: `src/app/api/work-os/voice/recap/route.ts`
- Test: `test/work-os-recap-route.test.mts`

**Interfaces:**
- Consumes: Tasks 1–3, `requireWorkOsAccess`, `jsonError`.
- Produces: `POST` accepting `{ intervalId: string; revision?: number; voice?: string }`, answering `200` `audio/wav` with headers `X-Work-OS-Recap-Voice`, `X-Work-OS-Recap-Revision` (the revision the lines belong to), `X-Work-OS-Recap-Lines` (URI-encoded JSON of `RecapSpeechLine[]`); `404` `{ error: "That recap is no longer available." }`; `400` for a bad body; `503`/`502`/`504` from the failure map (`not_configured`, `provider_error`, `timeout`), `422` for `too_long` with “That recap is too long to read aloud.”; `403` when the flag is off (from `requireWorkOsAccess`).

- [ ] **Step 1: Write the failing tests** — call the exported `POST(request)` with a stubbed auth module and a stubbed provider (inject through a module seam: export `__setRecapSpeechTestHooks({ access, fetchImpl })` from the route module guarded by `process.env.NODE_ENV !== "production"`, or mock with `node:test`'s `mock.module`). Assert: unauthenticated → 401; feature off → 403; `{}` → 400; unknown id → 404; happy path → `content-type: audio/wav`, the three headers, and `X-Work-OS-Recap-Lines` decoding to the recap's own lines; a stale `revision` in the body → the response carries the **current** revision in the header (the client refreshes before playing).

- [ ] **Step 2: Run and watch fail** → FAIL (no route module).

- [ ] **Step 3: Implement** — auth via `requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), authorization: req.headers.get("authorization"), requirePerson: true, feature: "voice_input" })`; load via `getActivityIntervalForPerson`; build lines (a `too_long` throw → 422); `speakRecap`; return `new NextResponse(audio, { headers: { "content-type": "audio/wav", "cache-control": "no-store", "x-work-os-recap-voice": voice, "x-work-os-recap-revision": String(revision), "x-work-os-recap-lines": encodeURIComponent(JSON.stringify(lines)) } })`. `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` like the transcriber route.

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit** — `feat(work-os): add the recap speech route`.

---

### Task 5: Shorter lines at the source, and the capability's new name

**Files:**
- Modify: `src/lib/work-os-activity-intervals.ts` (the synthesis JSON schema, ~line 385)
- Modify: `src/modules/work-os/admin/AdminSettings.tsx:30`
- Modify: `desktop/work-os-companion/src/admin/SettingsPage.tsx:37`
- Modify: `src/lib/work-os-readiness.ts:246`
- Test: `test/work-os-activity-intervals-prompt.test.mts`

**Interfaces:**
- Consumes: nothing.
- Produces: an activity description the card, the prompter and the voice can all use.

- [ ] **Step 1: Write the failing test** — read the module source and assert the activity field's description contains “lead with its clock time” and “at most 10 words”; assert both admin settings files carry `label: "Voice input & output"`; assert `work-os-readiness.ts`'s `fal_key_missing` message mentions both directions.

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement** — change the schema description to: `"A short, scannable line of at most 10 words naming one observable activity. Lead with its clock time when known, exactly like \"7:21 PM Reviewed the cursor-pagination code\" so the card can set the time as its own pill. No second activity, no counts, no provider names."` Keep `possible_task_reference` untouched. Relabel both admin rows and extend the readiness line to “FAL_API_KEY is required for Work OS voice input and output.”

- [ ] **Step 4: Run the tests** → PASS; then `npm run work-os:test` to confirm the existing synthesis tests still pass (the schema's required fields did not change).

- [ ] **Step 5: Commit** — `feat(work-os): tighten recap lines and name the voice capability for both directions`.

---

### Task 6: The prompter's and the window's math (pure)

**Files:**
- Create: `desktop/work-os-companion/src/recapSpeech.ts`
- Test: `desktop/work-os-companion/src/recapSpeech.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RECAP_VOICE_OPTIONS: ReadonlyArray<{ id: string; label: string; sample: string }>`; `normalizeRecapVoice(value: unknown): string` (must return one of the options' ids, defaulting to the first); `lineWeights(lines: Array<{ text: string }>): number[]` (each ≥ 1, proportional to `text.length + 12` for the pause between lines); `activeLineIndex(progress: number, weights: number[]): number` (`progress` 0–1, clamped, returns the index whose cumulative window contains it, `lines.length - 1` at 1); `prompterScroll(progress: number, weights: number[]): number` (0 at the first line, 1 at the last, monotonic, weighted the same way); `grownWindow(base: { width: number; height: number }, metrics: { lineHeight: number; prompterLines: number; chrome: number }, monitor: { width: number; height: number }, position: { x: number; y: number }): { size: { width: number; height: number }; position: { x: number; y: number } }` — width grows to 320 but never past the monitor, height by `lineHeight * prompterLines + chrome`, anchored at the bubble's bottom (the position's `y` decreases by the height delta) and clamped to `0` (never off the top or left/right edges).

- [ ] **Step 1: Write the failing tests** — monotonicity of `prompterScroll` over 0→1 in 100 steps; `activeLineIndex(1, weights) === weights.length - 1`; `activeLineIndex(0, …) === 0`; a single line → weight `[1]` and index 0 at every progress; `grownWindow` with a companion at the bottom of a 900px monitor grows upward and keeps `y + height` constant; near the top (`y: 10`) it grows downward instead (`y` stays); on a 320px-wide monitor the width stays 200.

- [ ] **Step 2: Run and watch fail** → `npx vitest run src/recapSpeech.test.ts`.

- [ ] **Step 3: Implement** — weighted cumulative windows; `prompterScroll` returns the *fraction through the windows*, not the raw progress, so the last line cannot land early; growth decides up/down from `position.y >= heightDelta` and clamps.

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit** — `feat(companion): prompter and window math for recap reading`.

---

### Task 7: Fetching the clip

**Files:**
- Modify: `desktop/work-os-companion/src/api.ts`
- Test: `desktop/work-os-companion/src/apiAudio.test.ts`

**Interfaces:**
- Consumes: the session/`secureState` rules already in `api.ts`.
- Produces: `apiRequestAudio(path: string, init: RequestInit): Promise<{ bytes: ArrayBuffer; mimeType: string; lines: RecapSpeechLine[]; revision: number | null }>` — mirrors `apiRequestBlob`'s auth and 401 handling, parses `x-work-os-recap-lines`/`x-work-os-recap-revision`, throws `ApiRequestError` with the server's `error` field for non-2xx.

- [ ] **Step 1: Write the failing tests** — stub `fetch`: 200 with the three headers → decodes the lines and returns the bytes; 401 → clears the session and emits `work-os://desktop-session-rejected` (assert both, as the JSON path does); 502 with `{ error }` → the error message is that copy; a missing lines header → `lines: []` and `revision: null`.

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement** — copy `apiRequestBlob`'s shape exactly (session read, `isSessionExpired`, headers with the bearer and `X-Work-OS-Organization-Id`, `cache: "no-store"`, 30s timeout), plus the header parsing and `dropRejectedSession(path)` on 401.

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit** — `feat(companion): fetch recap speech audio`.

---

### Task 8: The playback controller

**Files:**
- Create: `desktop/work-os-companion/src/useRecapSpeech.ts`
- Test: `desktop/work-os-companion/src/recapSpeechController.test.ts`

**Interfaces:**
- Consumes: Task 6's math, Task 7's fetch, `prefersReducedMotion`.
- Produces: `useRecapSpeech(options: { enabled: boolean; intervalId: string | null; revision: number | null; voice: string; onFailure: (message: string) => void }): { status: "idle" | "loading" | "playing"; lines: RecapSpeechLine[]; activeIndex: number; progress: number; toggle: () => void; stop: () => void }` plus a pure core `createRecapSpeechMachine(deps)` that the hook wraps (deps: `fetchAudio`, `createAudio`, `now`), so the state machine is testable without React.

- [ ] **Step 1: Write the failing tests** (pure machine, fake audio that records `play`/`pause` and lets the test set `currentTime`/`duration`):
  - `toggle()` → idle → loading → playing; a second `toggle()` while playing → idle and `pause()` called;
  - progress ticks (`ontimeupdate`) update `progress` and `activeIndex` from the weights;
  - the audio's `ended` → idle, progress 1;
  - a failed fetch → idle + `onFailure(copy)` once; a second press retries the fetch;
  - a second `play()` while playing does not create a second audio element (assert one `createAudio` call per clip);
  - `stop()` on a different interval clears the lines;
  - `prefersReducedMotion()` true → `activeIndex` still advances (the prompter itself decides not to slide).

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement** — one audio element reused across plays (created lazily, `src` set from a fresh `URL.createObjectURL` each clip, previous URL revoked); the fetch starts on `play()` only; `enabled: false` or a null interval → `toggle()` is a no-op; failures map through a `recapSpeechFailureCopy(reason)` helper added to `src/recapSpeech.ts` (bounded copy, mirroring the route's failure set).

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit** — `feat(companion): recap speech playback controller`.

---

### Task 9: The prompter

**Files:**
- Create: `desktop/work-os-companion/src/RecapPrompter.tsx`
- Test: `desktop/work-os-companion/src/RecapPrompter.render.test.tsx`

**Interfaces:**
- Consumes: `lines`, `progress`, `activeIndex`, `reduced`.
- Produces: `RecapPrompter({ lines, progress, activeIndex, reduced, className }: { lines: RecapSpeechLine[]; progress: number; activeIndex: number; reduced: boolean; className?: string })` — a three-line window (`.recap-prompter`, `.recap-prompter-window`, `.recap-prompter-line[data-active]`), the active line in the primary ink, others muted, translating by `prompterScroll` (no transform when `reduced`), and a hairline `.recap-prompter-progress > i` whose width is `progress`.

- [ ] **Step 1: Write the failing render test** — renders all lines; marks exactly one active; with `reduced` there is no inline `transform`; the progress bar's width equals `progress`; three or fewer lines render without a scroll offset; styles come from tokens (`var(--ink)`, `var(--line)`), not hard-coded hex.

- [ ] **Step 2: Run and watch fail** (`npx vitest run src/RecapPrompter.render.test.tsx`).

- [ ] **Step 3: Implement** — the window is `overflow: hidden` with a mask at both ends (the same treatment the mockups showed); the scroll offset is the *window-relative* position so the active line sits in the middle third; every line is announced once via one polite status region only when `reduced` (no live region spam while sliding).

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit** — `feat(companion): the recap teleprompter`.

---

### Task 10: The bubble, the window, and the mic

**Files:**
- Modify: `desktop/work-os-companion/src/AvatarApp.tsx`
- Modify: `desktop/work-os-companion/src/mascot-runtime.css` or `src/avatar.css`
- Test: `desktop/work-os-companion/src/avatarRecapSpeech.render.test.tsx` and `src/companion-assets.test.ts`

**Interfaces:**
- Consumes: Tasks 6–9; `AVATAR_COLLAPSED`/`AVATAR_EXPANDED` (lines 120–121); the recap bubble (lines 1928–1934); `useVoiceInput` (line 239).
- Produces: the collapsed bubble's Listen pill (`.avatar-bubble-listen`), the playing bubble (prompter + Stop), the mic chip's reading state (`.avatar-mic-reading` with the dots), and the window grow/restore calls.

- [ ] **Step 1: Write the failing tests** — a render test that the recap bubble shows **Listen** beside **View more** and no Listen when `facts.voiceAvailable` is false or there are no lines; a render test of the playing bubble showing the prompter and **Stop**; a render test that the mic chip shows dots and no mic label while `status === "playing"`; and source guards in `companion-assets.test.ts`: `invoke`-free window calls (`getCurrentWindow().setSize`), `grownWindow(`, `useRecapSpeech(`, and that starting a recording calls `stop()` (assert the mutual-exclusion line exists).

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement** — the bubble renders `RecapPrompter` instead of the headline/detail while playing; the pill toggles (Listen → Stop); the window grows on play and restores on stop/hide/expand using `grownWindow` + `LogicalSize`/`LogicalPosition` from `@tauri-apps/api/window` (capabilities already grant `set-size`, `set-position`, `current-monitor`, `outer-position`, `scale-factor`); the mascot and the elapsed pill keep their place; `useVoiceInput`'s start path stops the read first; `hide_avatar`'s tray path stops the read (add `stop()` to the effect that hides the window).

- [ ] **Step 4: Run the tests** → PASS; then `npm test` in the companion.

- [ ] **Step 5: Commit** — `feat(companion): read a recap from the bubble`.

---

### Task 11: Listen beside the confirm row

**Files:**
- Modify: `desktop/work-os-companion/src/ActivityIntervalCard.tsx`
- Test: `desktop/work-os-companion/src/ActivityIntervalCard.render.test.ts`

**Interfaces:**
- Consumes: Task 10's controller through props.
- Produces: `ActivityIntervalCard` accepts `onListen?: () => void` and `listening?: boolean`; when provided, the action row renders a **Listen** button beside the ✓ and ✎ buttons, becoming **Stop** while `listening`.

- [ ] **Step 1: Write the failing test** — the row shows a Listen control with the check and pencil when `onListen` is given, keeps its two-button shape when it is not, and shows Stop while `listening`; the button carries an accessible name that includes the recap's label.

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement** — reuse the existing `.chat-activity-action` button styles (no new radius or colour); the control sits after the pencil so the confirm action keeps its position.

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit** — `feat(companion): listen to a recap from its card`.

---

### Task 12: Otto talking

**Files:**
- Modify: `desktop/work-os-companion/src/mascotTypes.ts`, `src/StudioOtto.tsx`, `src/MascotPet.tsx`
- Modify: `desktop/work-os-companion/src/mascot-runtime.css`
- Test: `desktop/work-os-companion/src/StudioOtto.test.tsx`, `test/work-os-companion-mascot.test.mts`

**Interfaces:**
- Consumes: the existing `MascotRendererProps`.
- Produces: an optional `speaking?: boolean` on `MascotRendererProps`, `StudioOtto`, and `MascotPet`; while true the terminal face's mouth animates (`data-speaking="true"` + `.studio-otto-mouth` keyframes) and the pose is unchanged.

- [ ] **Step 1: Write the failing tests** — `StudioOtto` with `speaking` renders `data-speaking="true"` and the mouth element with the animation class; without it, neither; the mascot guard test still passes (`MASCOT_POSES` unchanged, no hardcoded art outside `mascot.ts`).

- [ ] **Step 2: Run and watch fail.**

- [ ] **Step 3: Implement** — a `speaking` prop threaded through, a 2-frame steps() mouth animation honouring `prefers-reduced-motion` (static open mouth instead), and the same prop passed from `MascotPet` (which the avatar window already uses).

- [ ] **Step 4: Run the tests** → PASS; `npm test`.

- [ ] **Step 5: Commit** — `feat(companion): a speaking treatment for Otto`.

---

### Task 13: The shipped voices, chosen by ear

**Files:**
- Create: `desktop/work-os-companion/public/voices/*.mp3` + `public/voices/README.md`
- Modify: `desktop/work-os-companion/src/recapSpeech.ts` (`RECAP_VOICE_OPTIONS`)
- Modify: `desktop/work-os-companion/src/VoicePicker.tsx` (new), `src/App.tsx`, `src/vault.ts`
- Test: `desktop/work-os-companion/src/VoicePicker.render.test.tsx`, `src/appearance.test.ts` (settings normalisation)

**Interfaces:**
- Consumes: `RECAP_VOICE_OPTIONS`, the vault settings shape.
- Produces: `WorkOsSettings.recapVoice: string` (defaults to the first option, normalised like the appearance settings), a Settings group **Voice** whose rows play the shipped sample and select that voice, and the sample files.

- [ ] **Step 1 (human in the loop): generate candidates and let the operator choose.** Write a throwaway script (kept out of the repo) that speaks one fixed sentence with six candidate voices through the route's own `synthesizeRecapSpeech`, writes them to `/tmp/opencode/voice-candidates/*.mp3` (transcoded with local ffmpeg), and pushes a browser screen (the brainstorm companion, same session directory) with an `<audio>` player per candidate. Ask the operator to pick three or four. Record the pick in the ledger task.
- [ ] **Step 2: Ship the pick** — commit the chosen samples as `public/voices/<id>.mp3` (each ≤ 60KB, mono, 44.1kHz MP3), list them in `RECAP_VOICE_OPTIONS` with plain labels (`Kore`, `Puck`, …) and the sample paths, and write `public/voices/README.md` naming the model, the sentence, and the date.
- [ ] **Step 3: Write the failing tests** — the picker renders one row per option, plays the sample on tap (stub `Audio`), and reports the chosen id; `normalizeRecapVoice("nope")` returns the first option; the vault round-trips `recapVoice` (extend the settings test that already covers `textSize`).
- [ ] **Step 4: Implement and run** → PASS.
- [ ] **Step 5: Commit** — `feat(companion): choose the recap voice`.

---

### Task 14: Verification, fixtures, and the release

**Files:**
- Modify: `desktop/work-os-companion/src/AvatarPreview.tsx` (fixtures)
- Modify: `desktop/work-os-companion/CHANGELOG.md`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
- Create: `test/work-os-recap-voice-e2e.mts` (live check, fixture employee)

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped release.

- [ ] **Step 1: Fixtures** — `?window=avatar&preview-recap=reading` (idle bubble with Listen), `reading` (prompter mid-line), `reduced` (stepped lines), and a large-text variant; add them to `AvatarPreview.tsx` the way the existing recap fixtures work.
- [ ] **Step 2: Rendered checks** — Vite dev server, Playwright screenshots of each fixture at 200×276 and at the grown size, asserting no console errors, no overflow outside the window, and the active line inside the middle third. (This is the frontend-design pass: one bold element — the sliding line — everything else quiet; no new colours, no new radii, tokens only.)
- [ ] **Step 3: TestSprite** — a plan against the `reading` fixture: press Listen, assert the prompter appears, the Stop control exists, and the mic shows the reading state; run it with `--local <port>` and keep the run id.
- [ ] **Step 4: Live end-to-end** — `test/work-os-recap-voice-e2e.mts`: sign in as `e2e-verify@wrazyos.com` (password from `/home/zahemen/.secrets/e2e-verify-password.txt`), fetch `/api/work-os/me/activity-intervals?date=<today>&limit=5`, take the newest ready interval, POST the route, and assert `audio/wav`, a non-trivial byte length, and that `X-Work-OS-Recap-Lines` decodes to that interval's own detail/activities. Run against the deployed app *after* deploy, and against a local build before it. **Note:** this task's live run needs the branch deployed to the VPS (AGENTS.md redeploy path) — schedule it with the release, not before.
- [ ] **Step 5: Release** — changelog bullet (“You can now listen to a recap instead of reading it — press Listen and Otto reads it to you while the words slide past.”), version bump to the next companion version in all three files, then the repo's release flow.
- [ ] **Step 6: Commit** — `feat(companion): read recaps aloud` + release chore.

---

## Self-review

- **Spec coverage:** goals 1–7 map to tasks as follows — Listen control (10, 11), speech (3, 4), prompter (6, 9), Otto talking (12), distinct waveform (10), one text (1, 5), voices + samples (13). Non-goals are respected (no autoplay, no other surfaces, no panel prompter). Anti-goals each have a guard: drift (2, 4, 7), waveform ambiguity (10), motion (6, 9, 12), cost (3, 4), and never blocking the decision (10 — the control is additive and independent of confirm).
- **Review Focus:** item 1 → Task 1/10 tests; 2 → Task 1/3/4; 3 → Task 3/4/8; 4 → Task 6 + Task 14 fixtures; 5 → Task 8 (stop paths) + Task 10 (expand keeps playing, hide stops).
- **Type consistency:** `RecapSpeechLine` (1) is used by 3, 4, 7, 8, 9; `revision: number` (2) flows into the route body (4) and the header (4, 7); `RECAP_VOICE_OPTIONS` (6, 13) is the client's only source of voice ids and Task 3's `RECAP_VOICES` must be asserted equal to it in test/work-os-recap-speech.test.mts (add that assertion in Task 13).
- **Proportion:** the plan is roughly the spec's length; code blocks are test assertions and one prompt string, not implementations.
