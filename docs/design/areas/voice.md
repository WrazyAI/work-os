# Voice input

**Use when:** Changing recording, transcription, microphone states, or hold-to-talk.

**Owns:** Record → transcribe → review, truthful receipts, bounds, and audio privacy.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing the shared composer: [In-app chat and shared tool cards](chat.md).
- Changing keyboard or focus behavior: [Actions, forms, menus, and keyboard behavior](../patterns/controls.md).
- Verifying capture states: [Design verification and handoff](../verification.md).

**Implementation starting points:** [voiceInput.ts](../../../desktop/work-os-companion/src/chat/voiceInput.ts), [ChatComposer.tsx](../../../desktop/work-os-companion/src/chat/ChatComposer.tsx).

Voice input is one interaction with two entry points: a record control in the
composer and a hold-to-talk shortcut. It is never ambient — the microphone
opens only for an explicit press or hold, and nothing is captured on mount, on
focus, on render, or on page load.

**Composer control.** On an empty draft the send control becomes the record
control in the same 36px slot and the same radius, so the composer never
changes shape between drafting and recording. The moment the draft holds text,
the control is the send again and recording is not offered from that slot: two
competing input methods in one slot would make the primary action ambiguous.
Text is never cleared or disabled to reveal the recorder. The web check-in
composer carries the same rule in its labeled-action language
(`Record update` ⇄ `Send update`).

**Capture state.** Recording replaces the composer's field row with a capture
row in the same grid: cancel (tertiary) on the left, a live level meter and the
elapsed clock in the center, and stop (the primary action) on the right. The
meter reads the real microphone signal — it is data, not an ambient loop — and
under reduced motion it stops easing while staying visible. The capture row is
the state, not the shell's chrome: the owning conversation surface strips the
composer's own border and fill, so a recording cue must live in the row, the
control, and the live region rather than in a shell treatment that does not
render. Transcribing shows the shared inline spinner and a `Transcribing…`
label. Escape cancels a capture and discards it without transcribing.

**Bounds and honesty.** A capture auto-stops at two minutes; a hold released
before the microphone opens still ends the capture rather than leaving it
running; leaving the window stops and keeps whatever was spoken; and a clip too
short to hold an utterance is discarded quietly instead of raising a "no
speech" error. Every failure names what failed and what to do — blocked
permission, no device, no speech, an oversized clip, an unavailable provider,
an unreachable workspace — and never exposes a provider payload, a credential,
or a stack trace. A deployment without transcription configured never renders a
record control that cannot work.

**Transcript and receipt.** A transcript is inserted into the draft, never
sent. It is the employee's text to review: nothing is filed, proposed, or
recorded until they send it themselves. A brief `Transcribed — review it, then
send` receipt acknowledges the conversion, the text stays fully editable, and a
failed transcription preserves the existing draft untouched.

**Hold-to-talk.** `Ctrl + M` is registered system-wide in the companion, so a
hold reaches the app from any application; in the browser it applies while the
page has focus. The press focuses the owning surface, opens it when collapsed,
and starts recording; the release ends the capture. The press binds the capture
to the window that received it, so the release can never land on the other
window. Registration is per device, toggleable in Settings, and Settings
reports the real registration state — a shortcut another application already
owns is never shown as live.

**Privacy.** Audio streams to the transcription provider through the server
proxy, is never written to disk or to the database, and is dropped as soon as
text comes back. The record control has an accessible name that states the
action, the capture row states that recording is live in text as well as
color, and the transcript is the only artifact that survives. The
hold-to-talk shortcut is named in the composer so it is never discovered by
accident.
