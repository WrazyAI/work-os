# Recap voice — design

Date: 2026-10-16
Status: awaiting operator approval (nothing is built from this until then)
Ledger: Nifty `3_2pTweUp9` — “Add voice playback to activity recaps”
Scope: the floating companion (macOS/Windows), the Activity Interval Review card, one new server route

## Intent and the why

A recap is read, not listened to, and reading a dense list invites a skim. In the
operator's words: *“the lines that I start skimming past are the bullet points… I
usually start skimming past the rest when I get to the bullet points or when I get
to the flow. For the flow I barely read it honestly.”* A skim confirms things that
did not happen — which is the worst failure a review surface can have, because the
confirmation is the record.

Audio carries order and cannot be skimmed. The teleprompter keeps the words on
screen while they are spoken, so checking by ear stays checking rather than
trusting — and the card underneath remains the audit record.

## Goals

1. A **Listen** control on the collapsed recap bubble, beside *View more*.
2. Otto **speaks the recap** in a chosen voice (Google Gemini 3.8 Flash TTS on
   fal — the same account the voice input already uses).
3. A **teleprompter**: the bubble grows to a three-line window whose lines slide
   and brighten with the audio; the last line lands as the audio ends.
4. **Otto looks like it is talking** while it reads.
5. A **distinct “Otto is reading” waveform** on the bubble and on the composer's
   mic, visually unlike the microphone's recording bars.
6. **One text**: the card's lines, the prompter's lines and the spoken words are
   the same words — tightened once at the source.
7. **Three or four voices** to choose from, with pre-generated samples that cost
   nothing to audition, and the choice remembered.

## Non-goals

- Reading anything else (EOD drafts, insights, chat replies, task detail). The
  same pain exists there; this is the recap first.
- Autoplay on arrival. Playback is always an explicit press.
- Voice cloning, per-employee voices, or languages beyond what the recap already
  contains.
- Changing the recap's evidence contract: screenshot counts, GitHub provenance,
  flow chips and the confirm/amend decisions stay exactly as they are.
- Streaming playback. A recap is short; one whole clip per recap is fine.
- Reading the *expanded* card. The panel keeps the record as-is; the prompter is
  the bubble's playing state.

## Anti-goals (what would make this a failure even if it works)

- **Drift.** The voice saying different words than the prompter or card shows.
  This is why the spoken script is assembled from the recap's own fields and
  returned with the audio, and why there is no second "telling" of the text.
- **Ambiguity in the waveform.** One shape meaning “audio in” and “audio out”.
- **Motion that hurts checking**: fast slide, small type, or no reduced-motion
  path.
- **Unbounded cost / an open TTS proxy**: a route that will speak arbitrary
  client text on the organisation's bill.
- **A slower decision.** The listen control must never delay the recap, the
  confirm button, or the next check-in.

## Constraints (verified, not assumed)

- **The provider returns audio only.** `google/gemini-3.8-flash-tts` (fal, Sept
  2026) returns a WAV file with no word timings, so the prompter must be driven
  by the audio's own clock. Inputs: `prompt` (verbatim text), `voice` (30
  prebuilt voices, default `Kore`), `style_instructions` (delivery, separate from
  the transcript), `enable_safety_checker`.
- **Existing precedent to reuse**: voice *input* already posts audio to
  `/api/work-os/voice/transcribe`, gated by the `voice_input` feature flag, with
  `FAL_API_KEY` server-only (`src/lib/aiTranscribe.ts`) and a readiness line the
  client shows (`voiceInputConfigured()`); the deployed key was rotated and
  verified 2026-10-16.
- **The companion window** is 200×276 collapsed, transparent, always-on-top,
  decorations off (`tauri.conf.json`); the mascot sits under the bubble with the
  elapsed pill below it.
- **Recap data** (`IntervalSynthesis`, `src/lib/work-os-activity-intervals.ts`):
  `headline` (≤70 chars), `detail` (≤60 words), `activities[]` with
  `description` (≤16 words, *“one observable activity, with its clock time when
  known”*), `workflow[]` phase chips, `uncertainties[]`, `apps[]`,
  `recordedActivity[]`, `coverage`. The card already splits a **leading** clock
  time out of an activity into a quiet pill (`splitActivityTime` in
  `ActivityIntervalCard.tsx`).
- **Mascot art** is SVG (`StudioOtto`, poses `idle sleep focus alert rest think
  celebrate recover` — there is no *speak* pose today).
- **design.md** contracts that apply: evidence-bounded copy and truthful
  provenance (§9), reduced motion (§10), semantic tokens (§3), bounded failure
  copy with a recovery route (§9 state matrix), and the “task-first, never
  block the decision” rule.

## Decided with the operator

1. A **Listen** pill beside *View more* (outline, not lime — reading stays the
   default offer).
2. The bubble **grows** to a three-line prompter while reading, then returns to
   its resting size.
3. Otto's waveform is the **breathing dots** (cream), used in the bubble and on
   the composer's mic.
4. The mic keeps the operator's idea — it becomes Otto's waveform while he reads
   — but in that distinct cream/dots treatment.
5. The teleprompter slides continuously, brightens the line being spoken, and
   shows a hairline of progress.
6. **One text** — card lines = prompter lines = spoken words.
7. Three or four voices, samples generated once and saved, the employee picks.

## Decided by the builder (check these)

1. **Sync math**: `position = audio.currentTime / audio.duration`; each line owns
   a share of the timeline weighted by its character count; the active line is
   the one whose window contains the position; smooth scroll between lines; it
   pauses and resumes with the audio, so the last line cannot land early or late.
   Stop only — no pause control at this length.
2. **The route returns the words and the audio together**:
   `POST /api/work-os/voice/recap` with the recap's id, not arbitrary text. The
   server assembles the script from the stored recap, synthesises, caches per
   (recap id, voice), and answers `{ lines, audio (base64 or a short-lived URL),
   durationMs, voice }`. This makes the “one text” rule enforceable, keeps the
   billed input bounded, and guarantees the prompter shows exactly what is said.
   Failure copy mirrors the STT route (`not_configured`, `provider_error`,
   `timeout`, `too_long`), each with the recap's own retry route.
3. **Deterministic script assembly** (no second model): the lines are the
   recap's activities in order, joined with light glue (“First… then… last…”),
   boundary times only where a gap matters, never the flow chips, never the
   counts. Nothing added, nothing abstracted away.
4. **Tighten at the source**: the synthesis prompt leads each activity with its
   clock time (“7:21 PM Reviewed the cursor-pagination code”) and caps the
   activity at about ten words, so the existing pill splitter yields
   `{time, text}` and `text` is already prompter-length. Older recaps whose time
   trails the phrase keep rendering as they do today.
5. **Growth geometry**: grow upward when the monitor leaves room above
   (the usual case), downward when the companion sits near the top; clamp to the
   monitor, keep the mascot and elapsed pill pinned, and restore the previous
   size and position when playback ends or is stopped.
6. **Reduced motion**: no sliding — lines advance in steps with a crossfade, and
   the hairline still reports progress.
7. **One audio owner**: recording and playback are mutually exclusive; starting
   either cancels the other, and the mic chip shows only one meaning at a time.
8. **Caching**: server-side per (recap, voice) so a replay is free and instant;
   the client keeps the last clip in memory for the current session.

## How it works

- **Server**: new route + a small `work-os-recap-speech.ts` module (script
  assembly + provider call + cache). Same auth shape as the transcribe route
  (`requireWorkOsAccess`, `requirePerson`, feature flag), same server-only key.
- **Companion**: a playback controller (one audio element, one owner), the
  prompter component, the Otto speaking animation, the dots on the bubble and the
  mic chip, and the settings row for the voice.
- **Voice picker**: 3–4 pre-generated sample clips shipped with the app (static
  assets, same sentence each), the choice stored beside the existing appearance
  settings and normalised like `appearance.ts`.
- **Art**: one new small pose for the SVG face (or `focus` plus mouth motion, if
  the pose proves unnecessary) — decided during the plan, not here.

## Verification

- **Unit**: script assembly (order, glue, boundary times, old-format fallback),
  line weights and the position→line mapping, settings normalisation.
- **Route**: auth, feature flag, cache hit/miss, size and length caps, provider
  failures mapped to the employee copy.
- **Rendered**: idle bubble, playing bubble (grown), stopped state, mic states,
  reduced motion; fixtures for each, checked at the companion's own size.
- **Live**: the fixture employee (`e2e-verify@wrazyos.com`) against the deployed
  route with a real recap, asserting audio comes back and the lines match what
  the card shows; plus the companion's own macOS/Windows startup gate.
- **The operator's test**: press Listen on a real recap and confirm by ear.

## Open items for the plan

- The exact three or four voices (samples generated, the operator picks).
- Growth pixel math per text size / mascot size (both are accessibility
  settings, so the bubble's resting and grown heights differ).
- Whether the guard rail for very long recaps is a length cap, a slow-down, or
  refusing to read and offering the card — the plan picks one.
