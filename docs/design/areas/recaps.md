# Activity interval reviews

**Use when:** Changing recap content, evidence panels, provenance, confirm/amend, or the recent-activity stream.

**Owns:** Evidence-bounded interval summaries and review states; task suggestions have their own guide.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing evidence semantics or async states: [Data truth, async states, and pagination](../patterns/data-and-state.md).
- Changing post-review task proposals: [Next-step suggestions after recap approval](next-steps.md).
- Changing reminders or floating geometry: [Floating companion, Otto, and assets](floating-companion.md).
- Changing recap use in eod reports: [Employee EOD review](eod-review.md).

**Implementation starting points:** [ActivityIntervalCard.tsx](../../../desktop/work-os-companion/src/ActivityIntervalCard.tsx), [ActivityIntervalList.tsx](../../../desktop/work-os-companion/src/ActivityIntervalList.tsx), [EmployeeActivityRecaps.tsx](../../../src/modules/work-os/employee/EmployeeActivityRecaps.tsx).

## Interval identity and evidence bounds

A progress prompt may arrive as an Activity Interval Review: a grounded recap
of the interval since the last update, built from the existing secure
Worktivity screenshot pipeline. The interval is the server-resolved prompt slot
(session + due time), never a clock hour, so pauses, manual updates, and cadence
drift cannot split or repeat the same window.

The recap is descriptive and evidence-bounded. It may describe visible apps,
tools, artifacts, and an apparent work sequence, and it must keep what the
evidence does not establish available without crowding the summary. It may not
claim productivity, effort, pay eligibility, completion, deployment, or
quality; the synthesizer always receives the ordered per-frame observations and
only a bounded representative subset of raw frames.

## Card anatomy

Read the recap, don't wade through it. It presents as one short lead sentence,
then short activity bullets (one observable activity each, with its clock time
when known, set as a quiet time pill), an ordered `Flow` track of phase chips
only when the evidence supports a sequence, and a bottom row of two buttons:
`Extra notes` (holding at most three short, interval-specific gaps the employee
could clarify) and an evidence button whose label is its screenshot and GitHub
event counts as icon metrics — never the word "Evidence". Nothing is expanded
by default, so the row reads as buttons rather than an accordion; toggling a
button animates its panel open beneath the row, only one panel is open at a
time, and the evidence button's hover label reads the same counts in words.
Analysis coverage (frames analyzed of frames recorded) is a quiet line inside
the evidence panel, never in the summary, and the recap never restates generic
caveats such as screenshots not establishing completion. A dense multi-sentence
paragraph is a contract violation, never a rendering fallback for new
intervals.

A recap summary delivered as a chat turn is still a conversation message:
hovering it offers `Copy` plus one short destination action — `All recaps` —
that opens the stream where every recap lives (the floating companion's Tasks
tab). The action never replaces Copy and never appears on turns that are not
recaps.

## Memory context

When Work Memory is enabled for the person, the synthesizer also receives a
bounded additional-context block: the live day snapshot (focus, agenda,
completed and deferred items, recent substantive updates, shift state) and a
recalled-history block retrieved for the interval's own work (the day's stated
focus plus the observed apps and possible task references). That context exists
only so the recap understands what the employee is currently working on. It is
labeled informational, is never screenshot evidence, can never add completion,
progress, or activity claims, and can never contradict the frames. It is
treated as data, never as instructions, and a structured activity or workflow
phase that cites no frame is dropped, so every retained claim stays traceable
to the interval's observations. A memory recall failure degrades silently to an
evidence-only recap, and interval coverage records whether memory context was
used.

## Recorded GitHub activity

When the GitHub evidence integration is enabled and the employee has verified
GitHub accounts, the synthesizer also receives a bounded recorded-activity
block for the interval window. It separates two relationships: `performed`
(the employee's own accounts pushed, opened pull requests, reviewed, or opened
issues) and `triggered by their work` (CI runs linked to a commit they pushed
in the same window, deployments they created, and reviews or closures on their
pull requests). Recorded activity is provider fact, so the recap may state it
exactly as recorded and leads with it when present — but a merged pull request,
a passing workflow, or a deployment is never Nifty task completion, and
triggered items are never described as the employee's own action. GitHub events
stay inside the recap's evidence panel: its button shows the screenshot and
GitHub counts as icon metrics, and opening it reveals separate `Screenshots`
and `GitHub activity` sections; each GitHub item retains its `You` / `Your
work` tag and artifact link. The model's structured `recorded_activity` output
is kept only when it matches the recorded list, so it cannot fabricate an item.
A GitHub read failure degrades silently to a Worktivity-only recap, and
coverage records whether GitHub context was used.

## Review provenance

Review adds provenance without creating employee-authored truth:

- `inferred` — the AI recap as generated; silence leaves it here, and it still
  never advances the employee's substantive-update cadence.
- `confirmed` — the employee said “Looks right”.
- `amended` — the employee added or corrected context; the original AI text is
  preserved and a reviewed recap is frozen against later evidence.

## Recent activity stream

The floating companion's Tasks tab renders these as a Recent activity stream in
the chat card language, newest interval first: interval label, quiet provenance
chip (`Not reviewed`, `Confirmed`, `Updated by you`), a concise headline, the
detail, and the same bottom row of two buttons — `Extra notes`, which holds the
inferred provenance line and any gaps, and the evidence button, whose label is
its screenshot and GitHub counts as icon metrics. Opening the evidence panel
reveals separate `Screenshots` and `GitHub activity` sections: screenshots show
the exact analyzed frames with capture time and neutral frame summary, while
GitHub shows provider-recorded events with their relation tags and links. The
floating stream's header carries a dark `View in app` action on the right that
opens the dock's Focus tab in the main window, where the same stream sits
beneath the daily goal. Expired images say
so honestly without deleting the recap; there are no charts, scores, or hours
totals.

The Tasks tab leads with the day's open work, then the stream. The `Open tasks`
card sits at the very top — the overdue/pending list is the first thing the
employee sees, not something below a month of recaps — and it collapses whole
from its far-right disclosure: collapsed it keeps a one-line account of the
open work (`N pending · M overdue`, or the current selection), and the choice
is remembered on the device (best-effort local storage, default expanded).

The stream itself pages on demand rather than loading the range up front. One
request returns at most twelve recaps (the cards are tall; a page is a
screenful or two), and the open edge carries one explicit `Load more` control
with a `Showing N of M` line while more history exists; appended pages stay
mounted and the count chip states the complete range. This follows the Tasks
list's deliberate exception to the streaming-list contract ([paged and streaming lists](../patterns/data-and-state.md#paged-and-streaming-lists) / [employee task views and ordering](tasks.md#views-and-ordering)):
paging is never automatic, so opening the tab, approving a recap, or appending
a page never yanks the reader's position.

## Due recap review bubble

The chat bubble for a due recap is a short conversational card: the interval
label (the window itself already says it covers the last hour, so no lead-in
line repeats it), the headline and the evidence-bounded detail (tall enough to
carry the brief summary of the observed window). It asks `Sounds good?` with
two round icon actions: the check confirms the recap in place (accessible name
`Looks good`, with the ask line reading `Saving…` while the decision files),
and the pencil (`Edit`) hands editing to the composer, which switches to
recap-edit mode (an `Editing your recap` strip with `Cancel` and an
`Update recap` send label) so the employee writes the correction themselves.
The inferred provenance line — `Inferred from your screenshots — add or correct
anything missing.` — lives inside the `Extra notes` panel, never on the card
face. Sending that note records it as the employee amendment.
Neither action mutates anything other than the recap, and the Tasks-tab stream
keeps its inline review as the same round check (`Looks right`) and pencil
(`Add or correct`) actions.
