# Phase 2 Prompt — Adaptive Companion and Voice Interaction

You are implementing Phase 2 of the Work OS desktop companion pilot in `/home/maigreeks/projects/work-os`. Phase 1 must already provide an explicit work session, a confirmed daily plan, shift-aware server scheduling, Nifty-backed task proposals, and offline reconciliation.

The pilot employee is David, a software engineer. Preserve the existing Work OS functionality and safety rules. Do not expand to other worker types.

Before changing code, follow the repository `AGENTS.md`, preserve the dirty worktree, read/reuse the current Nifty ledger task, inspect the current Phase 1 contracts, and use only the absolute WSL Node/npm paths. Read relevant Tauri 2 and Next 16 documentation from installed dependencies before using framework APIs.

## Objective

Turn the desktop companion into a low-friction, context-aware assistant that can appear at useful moments, accept text or voice updates, and adapt its next prompt to David's declared plan without becoming an intrusive hourly alarm.

## Deliverables

### 1. Companion interaction model

Implement a compact, optional companion surface with these states:

```text
idle
clock_in_greeting
awaiting_plan
progress_check
blocker_follow_up
eod_due
offline
quiet
```

The surface may use a floating avatar/pet, tray popover, or compact window, but it must:

- Never steal focus while David is typing or presenting.
- Be dismissible and snoozable.
- Respect quiet mode, breaks, meetings when available, and notification preferences.
- Collapse to the tray.
- Meet keyboard navigation and screen-reader requirements.
- Avoid desktop-wide tracking or window inspection beyond explicitly authorized evidence providers.

Use a deterministic state machine. Animation is presentation, not state.

### 2. Contextual prompting

Generate prompts from the current work session, plan, last substantive response, blockers, task changes, and shift boundary. Examples:

- “You planned to finish the debugger fix and package the Windows build. What changed?”
- “The deployment task is still blocked. Is the certificate still the dependency?”
- “Your shift ends in eight minutes. Record your final update and I’ll prepare the EOD draft.”

Retain an hourly reminder only as a fallback. Calculate the next prompt server-side and explain why it is scheduled. Ensure stale notifications do not fire after a newer response, clock-out, or schedule change.

### 3. Voice capture and transcription

Add push-to-record voice updates with:

- Clear microphone state and duration.
- Explicit start/stop/cancel controls.
- Local temporary-file handling.
- Bounded recording size and duration.
- Retryable upload/transcription.
- Transcript display before interpretation.
- Transcript correction before proposals are created.
- Immediate deletion of temporary audio after the configured retention point.

Use the existing OpenAI credential for transcription unless a different provider is explicitly approved. Never embed provider credentials in the desktop binary. Upload through an authenticated Work OS API using a private storage path or stream; do not send audio through public storage.

### 4. Structured interpretation

Convert corrected transcripts into typed candidate updates:

```ts
type CandidateWorkUpdate = {
  originalTranscript: string;
  taskMatches: Array<{ taskId: string; confidence: number }>;
  claims: Array<{
    kind: "progress" | "completion" | "blocker" | "priority_change" | "new_work";
    statement: string;
    taskId?: string;
  }>;
  proposedOperations: WorkOsProposal[];
};
```

Show the employee exactly what the agent inferred. Allow editing, removing, or remapping every proposed operation. Preserve the original transcript separately from the agent interpretation.

### 5. Offline and failure behavior

Voice recording may be captured offline, but transcription and provider-backed interpretation must wait until connectivity returns. Make queue state visible. Do not repeatedly upload the same audio. Distinguish microphone denial, transcription failure, model failure, and Nifty failure.

Text input must remain fully usable when voice is unavailable.

### 6. Notification and prompt quality controls

Add safeguards for:

- Notification deduplication.
- Maximum interruption frequency.
- Escalating backoff after ignored prompts.
- No ordinary prompt in the final hour.
- No prompt after clock-out.
- Quiet mode and snooze expiry.
- Restart recovery.
- Multiple-monitor and DPI-safe positioning.
- A visible explanation for why the companion appeared.

### 7. Scenario debugger coverage

Extend the existing debugger with presets for every companion state, microphone states, ignored reminders, offline voice queue, transcript correction, final-hour suppression, and EOD transition. Keep the debugger available in-process if native secondary WebViews remain unreliable in the Windows cross-build.

## Verification

Add automated tests for the companion state machine, prompt deduplication, stale notification cancellation, transcript schema validation, correction-before-proposal behavior, audio size limits, temporary-file cleanup, offline replay, and final-hour suppression.

Perform native Windows tests for:

- Notification delivery.
- Microphone permission allow/deny.
- Record, cancel, transcribe, correct, and submit.
- Floating/tray behavior across restart.
- No console window.
- No focus stealing during normal work.

## Definition of done

Phase 2 is complete only when David can:

1. Clock in and receive one contextual plan prompt.
2. Dismiss, snooze, or answer without losing his current work context.
3. Record a voice update, review/correct the transcript, and approve the resulting task proposals.
4. See later prompts refer to his actual stated plan and blockers.
5. Ignore a prompt and receive bounded, backoff-controlled reminders rather than notification spam.
6. Reach the final hour without ordinary progress prompts.
7. Receive the EOD prompt 5–10 minutes before shift end.
8. Continue with text and queued updates when voice or connectivity fails.
9. Restart the app without duplicate notifications or lost accepted state.

Completion requires native Windows evidence and accessibility checks, not only browser or scenario-debugger rendering.

## Needed to proceed that is not already available in `.env.local`

No additional API secret is required if OpenAI is used for transcription; `OPENAI_API_KEY` is already present. The following inputs or permissions are still required:

- Approval to use OpenAI transcription and a selected transcription model/retention policy.
- David's consent for microphone capture and the Windows microphone permission during native testing.
- The companion visual direction: supplied avatar/pet assets, or approval to design them.
- Companion tone, name, animation intensity, quiet-mode defaults, and maximum interruption frequency.
- A decision on maximum recording duration and whether raw audio is deleted immediately after a corrected transcript is accepted.
- A Windows interactive session for notification, microphone, DPI, focus, and tray acceptance.

If signed pilot distribution is required in this phase, the release secret store must provide `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_UPDATER_PUBLIC_KEY`, `WINDOWS_CERTIFICATE_BASE64`, and `WINDOWS_CERTIFICATE_PASSWORD`; these are correctly absent from `.env.local`.
