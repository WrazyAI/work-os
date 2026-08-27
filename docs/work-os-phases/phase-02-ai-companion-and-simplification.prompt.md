# Phase 2 Plan — Working AI Companion, Reminders, and UI Simplification

**Status:** Approved direction, superseding `phase-02-adaptive-companion-and-voice.prompt.md`
**Owner:** Product (David + manager), engineering (agents)
**Source inputs:** Manager review 2026-08-25, MVP requirements 2026-08-21, phase-02 spec v1
**Applies to:** Work OS desktop companion (employee surface) and supporting Work OS API routes

---

## 0. Decisions from owner review (binding)

1. **The AI assistant ships working, out of the gate.** Basic features intact: all reminders, talk-to-AI updates on David's behalf, AI-drafted EOD, AI insights synthesis.
2. **UI simplification is in scope.** Employee surface collapses to three tabs: **My Day, Tasks, EOD Review**. "My Day" must answer three questions at a glance: Am I clocked in? What am I working on today? What is overdue/open? Asana is the simplicity benchmark; ClickUp is the counter-example.
3. **Insights stays.** AI insights synthesis needs the surface; revisit its placement after this phase.
4. **Evidence is hidden, not removed.** Keep the route, components, and API intact behind a feature flag with a visible placeholder explaining it is coming back. Future agents must be able to re-enable it or build on it without archaeology.
5. **Voice capture and transcription are deferred** to a later phase (see §8). Text input is the primary path this phase.
6. **Nifty is de-emphasized, not removed.** Manual task entry is primary; Nifty sync continues as a silent background failsafe. User-facing Nifty language fades from the UI this phase. Full Nifty migration is deferred.
7. EOD gains a required bottleneck question ("What prevented you from completing your task list?"). EOD screen-recording walkthroughs are a David process change, not an app feature.
8. Schedule data continues to come from the employee profile (no admin assignment flow). Milestone grouping is out of scope for MVP.

---

## 1. Objective

Turn the desktop companion into a working AI assistant with the minimum surface that feels inevitable: it reminds David at the right moments, converses about his work, files updates on his behalf after his approval, drafts his EOD from the day's record, and summarizes his insights — inside a UI simple enough that his manager can follow it without a walkthrough.

Model direction: `gpt-5.6-luna` via OpenRouter for generation and interpretation. **Provider credentials never ship inside the desktop binary** — AI calls are proxied through authenticated Work OS API routes holding the key server-side (OpenRouter key currently in project env is a development convenience only). Transcription is deferred with voice (§8), so no audio provider is needed this phase.

---

## 2. Deliverable A — Reminder engine (foundation)

The deterministic companion core. Everything else in this phase is a view of it.

### State machine
`companionMachine.ts` — a pure reducer over: session gate, `day.prompt` (server-computed `nextPromptAt`/`required`/`kind`), today's plan, overdue/carry-over counts, last substantive response, blockers, quiet mode, snooze state, and clock.

States (extends the v1 spec set):

```text
idle · clock_in_greeting · awaiting_plan · progress_check · blocker_follow_up
eod_due · offline · quiet
```

Outputs: the current companion state plus a prompt payload (why now, what it references, what action it offers).

### Quality controls (from phase-02 spec §6 — all enforced here, not in UI)
- Notification deduplication (stable ids per cause).
- Maximum interruption frequency; escalating backoff after ignored prompts.
- No ordinary prompt in the final hour; **EOD prompt 5–10 minutes before shift end**.
- No prompt after clock-out; stale prompt cancellation after a newer response, clock-out, or schedule change.
- Quiet mode and snooze expiry; restart recovery without duplicate notifications.
- A visible explanation for why the companion appeared.

### Desktop notifications
Add `tauri-plugin-notification` with a permission flow. Machine transitions map to OS notifications (hourly check-in reminder, blocker follow-up, EOD ping, overdue nudge). Notifications consume the same event stream the (later) avatar will.

Server contract stays: prompts are scheduled server-side (`day.prompt`) and explained in-product; the machine never invents its own schedule, it only consumes and snoozes.

---

## 3. Deliverable B — Talk to the AI; updates on your behalf

The composer becomes a conversation with the assistant.

- David writes plainly ("finished the debugger fix, the packaging step is blocked on the certificate"). The AI classifies it, matches it to today's tasks, and drafts the structured update(s).
- **David approves before anything is filed.** Every proposed operation is shown, editable, removable, and remappable (preserves phase-02 spec §4 and the platform AI-governance rules). The original text is preserved separately from the interpretation.
- Interpretation uses the typed contract from the v1 spec:

```ts
type CandidateWorkUpdate = {
  originalInput: string;
  taskMatches: Array<{ taskId: string; confidence: number }>;
  claims: Array<{
    kind: "progress" | "completion" | "blocker" | "priority_change" | "new_work";
    statement: string;
    taskId?: string;
  }>;
  proposedOperations: WorkOsProposal[];
};
```

- Architecture: new authenticated server route (e.g. `POST /api/work-os/me/interpret`) proxying to OpenRouter (`gpt-5.6-luna`) with JSON-schema-constrained output. Key lives server-side. Distinguish and label four failure classes: AI unavailable, model refusal/malformed output, Nifty failure, network offline.
- Offline: input is always usable; interpretation requests queue and replay (existing offline queue); receipts must state what is pending vs. confirmed. The existing deterministic classifier becomes the offline fallback, clearly labeled.
- Updates should be phrased for a non-technical reader (manager feedback: current updates are too jargon-heavy). The AI drafts in plain language; David's original wording stays attached.

---

## 4. Deliverable C — AI-drafted EOD

- Through the day, approved updates, completions, blockers, and (post-MVP) evidence accumulate in the workday record — this already largely exists via check-ins.
- At `eod_due`: the AI drafts the EOD from that record — plain-language narrative, completed vs. carried-over vs. blocked, in a form the manager can read without a walkthrough.
- **Bottleneck question is required**: "What prevented you from completing your task list?" — asked directly if the AI cannot infer it from a recorded blocker.
- David reviews, edits, and submits. The existing deterministic draft (`draftWorkOsEod`) becomes the offline/AI-unavailable fallback, labeled as such.
- Manager-side AI analysis of EODs remains a web/HR concern (phase 4 territory); the desktop only produces the draft.

---

## 5. Deliverable D — Insights synthesis

- The AI summarizes the Insights page: the week's observed time, task completion, wins, attention items, and next focus — grounded in the existing deterministic brief and exact values table (the AI narrates; it does not invent numbers).
- Synthesis is labeled as AI-generated with its data freshness. If the model is unavailable, the deterministic brief renders unchanged.
- The Insights page remains reachable this phase (see §6 tab plan).

---

## 6. Deliverable E — UI simplification (employee surface)

Design authority: `design.md`. The boss's My-Day contract is the acceptance test.

1. **Three employee tabs: My Day, Tasks, EOD Review.**
   - Nav renames "Today" → "My Day" and "Review" → "EOD Review"; EOD Review absorbs the review/proposal queue.
2. **My Day answers, at a glance:** am I clocked in (slim status bar), what am I working on today (focus + today's tasks), what is overdue/open (count with tap-through to a filtered Tasks view).
   - The current large focus block becomes a **slim bar**; carry-over and completion metrics compress into it.
   - "What are you working on today?" input lives in My Day, not the Tasks tab.
3. **Tasks becomes the history/filter view:** Open · Overdue · Completed, with search and date filters (already built) and an Add-task shortcut. Completed carry-overs log under today's completed for HR visibility.
4. **Evidence hidden behind a placeholder.** Remove it from the employee navigation and views, but keep the route, components, API routes, and the worktivity/evidence libs fully intact. Introduce a single feature flag (e.g. `FEATURES.evidence = false`) plus a placeholder note in the settings/about area ("Evidence is coming back — provider-verified proof of output") so future agents can re-enable the surface by flipping the flag and restoring the nav entry. Document the flag in this file and `docs/design-exceptions.md` when it lands.
5. **Insights remains** reachable this phase (nav or My Day link) — required by Deliverable D; placement re-evaluated at phase end.
6. **Nifty de-emphasis:** remove user-facing "Nifty" copy from primary task surfaces (tasks are just tasks; manual entry is primary). Sync status may live in Settings/diagnostics only. Keep all sync functionality as the background failsafe.
7. Role rules stay: employees default assignee to themselves; managers may assign others (existing behavior, verify in tests).
8. All simplification work follows `design.md`: task-first hierarchy, semantic status colors, progressive disclosure, no card-grid sprawl; screenshot-verified at wide/compact widths including empty, dense, and offline states.

---

## 7. Cross-cutting requirements

- **Offline-first:** every deliverable must work through the existing offline queue and scenario-debugger fixtures. The AI features degrade to labeled deterministic fallbacks, never dead ends.
- **Truthful provenance:** observation ≠ completion ≠ provider-confirmed (design.md §2.4, §18). AI drafts are labeled; approval is explicit; queued is not "sent."
- **Credential safety:** no provider key in the binary, env-bundled assets, or local config shipped to other machines (phase-02 spec §3 posture, extended to OpenRouter).
- **Scenario debugger coverage (spec §7):** presets for every companion state, ignored reminders/backoff, quiet mode, snooze expiry, restart recovery, EOD transition, offline queue replay, AI-unavailable fallback, and the UI-simplification surfaces. The `?offline` / sync-bypass mode is the primary dev harness.
- **Tests:** state machine transitions and §2 quality controls, interpretation schema validation, approval-before-file behavior, EOD bottleneck requirement, fallback paths, notification dedupe/stale cancellation, tab/nav structure, and the Evidence flag (hidden by default, restorable).

---

## 8. Deferred to a later phase (not in Phase 2)

- **Voice capture and transcription** (v1 spec §3 entire): push-to-record, mic permissions, temporary audio handling, Whisper transcription. Revisit as its own phase after Phase 2 ships; text is fully first-class until then.
- **Nifty → native task storage migration.** Sync stays as failsafe; migration is a standalone project with its own data-backup prerequisites.
- **GHL call-data sync**, **AI time-estimation analytics**, **Mac port**, **signed pilot distribution** (signing secrets intentionally absent), **floating avatar visual design** (the state machine and notification layer are built so the avatar can be added as a presentation layer without rework; asset/tone decisions still needed from the owner).
- Note: the original `phase-03` (evidence & verification) and `phase-04` (manager review) prompt files remain on file; the Evidence surface they depend on is preserved (§6.4) and the manager-review scope now partially lands inside Deliverable C.

---

## 9. Definition of done

Phase 2 is complete only when David can:

1. Clock in and receive the plan prompt, and go hours without notification spam (dedupe + backoff proven).
2. Ignore a prompt and see bounded, escalating reminders — never in the final hour, never after clock-out.
3. Type a plain-language update, review what the AI inferred, edit/remap it, and approve it for filing — with the original wording preserved.
4. Watch his approved updates accumulate and receive an AI-drafted EOD at shift end that answers the bottleneck question, reviewable and editable before submission.
5. Open Insights and read an AI synthesis grounded in the exact values.
6. Use My Day to answer clocked-in / working-on / overdue at a glance, with overdue tap-through into a filtered Tasks view.
7. Do all of the above offline or with the AI down — degraded and labeled, never stuck.
8. Restart the app without duplicate notifications or lost state.

Completion requires native Windows evidence (notification delivery, focus behavior, tray, DPI) plus scenario-debugger coverage — browser rendering alone is not acceptance.

## 10. Needed inputs / decisions still open

- Companion naming/tone (assistant copy voice), quiet-mode defaults, and max interruptions per hour — owner call, defaults proposed during build.
- OpenRouter account/project key placement for the production server (`WORK_OS_AI_PROVIDER=openrouter`, key in server env only).
- Whether Insights is nav-level or a My Day link after Deliverable D lands.
- Aiden/MVP demo date confirmation (Aug 28 target from the Aug 21 meeting) against this scope.
