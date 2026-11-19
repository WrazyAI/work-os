# Floating companion, Otto, and assets

**Use when:** Changing floating chat, collapsed Otto, prompt bubbles, view switching, or mascot identity.

**Owns:** Floating-window behavior, configured art, prompt dismissal, and mascot placement.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing shared chat frames or tool approvals: [In-app chat and shared tool cards](chat.md).
- Changing recap review: [Activity interval reviews](recaps.md).
- Changing next-step bubbles: [Next-step suggestions after recap approval](next-steps.md).
- Changing EOD prompt priority: [Employee EOD review](eod-review.md).
- Changing elapsed time or shift progress: [Scheduled and flexible arrangements](profile-and-schedule.md#work-arrangements-and-fixed-day-flexible-hours).
- Changing capture or hold-to-talk: [Voice input](voice.md).

**Implementation starting points:** [AvatarApp.tsx](../../../desktop/work-os-companion/src/AvatarApp.tsx), [mascot.ts](../../../desktop/work-os-companion/src/mascot.ts), [MascotMark.tsx](../../../desktop/work-os-companion/src/chat/MascotMark.tsx).

## Floating Otto chat

The floating companion uses the same white window border/header treatment and
the same composer anatomy. The window remains inside the viewport, grows the
composer with the draft, and uses detached menus that cannot be clipped by a
scroll region. Minimize-to-orb and hide-window remain distinct and truthfully
named.

The thread owns scrolling, but its bottom dissolve belongs to the fixed
composer edge, not the scroll content: keep the thread fully opaque, disable
scroll anchoring while an inline task card expands, and place the short fade
outside the scroller at the composer’s top border. Task-card selection and
confirmation actions remain clear above that edge. The Tasks view is a reading
list, not a thread: entering it starts at the top, and nothing that arrives —
a recap decision, a new recap, or an appended page — moves the reader. The
chat tab alone follows the thread scroll contract.

Both chat surfaces use the configured mascot head crop through
src/chat/MascotMark.tsx. Never hardcode mascot art, the mascot name, or a
generic sparkle as agent identity. Global mascot changes belong in mascot.ts.

The mascot at the far left of either Otto header is also the one Employee /
Admin view control for an administrator. Its detached menu marks the current
view and explains an unavailable destination; the floating window follows the
main window's selected workspace and swaps to the matching real conversation.
The in-app and floating Administration surfaces render the same Admin Otto
chat engine and confirmation contract, never a second admin implementation.
View changes retain the conversation identity, drafts, and unconfirmed
previews; the Administration masthead's **Ask Otto** control reopens that
retained conversation, while **New chat** remains the durable discard. Closing
and reopening either Administration surface therefore rehydrates the same
server thread, and assistant turns carry their recorded local time plus the
same session dividers as the employee chat. A view switch is a presentation
choice, never an authorization boundary.

Prompt reminders — the plan question, a due check-in, the EOD nudge — are
scaffolding for the prompt they announce. The companion may show one in the
thread, but it is removed as soon as that prompt is answered or replaced, is
never written to the vault or sent as conversation history, and never replays
in the agent's stored context. A scheduled check-in appears only once its
prompt time arrives: confirming the plan never triggers an immediate check-in
demand. A due check-in leads with the day's overdue count (`N tasks are
overdue`) when open work is past its due date — the one task fact that belongs
in the ask itself, because it is the day's outstanding state — and then the
check-in ask.

Both chat surfaces carry the same voice input contract ([voice input](voice.md)): the record
control takes the send slot only while the draft is empty, and a transcript
lands in the draft for review.

## Mascot and custom assets

Otto is configured once in
desktop/work-os-companion/src/mascot.ts: name, poses, art, and crop. Render
the configured identity through Otto or MascotMark according to surface.

Administration adds a charcoal open-front blazer, a signal pocket square, a
brass lapel pin, and thin brass spectacles to the one configured Studio Otto
renderer. The accessories belong to the mascot, so every pose and crop keeps
them without a second art path. Only the still-mounted collapsed pet plays the
one-shot dressing or undressing transition; header marks and chat marks render
the final state without motion. Opening, collapsing, or replaying a pose never
replays the outfit transition, and reduced motion renders the final dressed
state immediately. The collapsed Administration orb carries a small `Admin`
text label so the state never depends on costume alone.

The mascot is a quiet guide, not a dashboard card and not a status replacement.
It may appear as:

- a small head mark beside agent speech;
- a restrained full figure in a ready hero;
- a full figure on the first-run stage — the connect screen, the welcome, and
  the setup steps — and on the pre-app loading screen and its failure state,
  where he is honestly working at his bench of light or recovering; the
  launch loader is his bench, never a generic widget;
- a compact orb in the floating companion;
- a thinking/recovering/celebrating state when the corresponding event is real.

The compact floating companion has no circular halo or backdrop behind the
mascot. Keep elapsed session time visible while a shift is open, including while
paused; subtract completed breaks and freeze the timer at the current pause.
For scheduled arrangements, the elapsed pill is also the shift-progress
instrument: a lemon-green fill reveals the scheduled day from left to right,
pale at the start and deeper as the shift completes, and reaches full at the
scheduled end. The elapsed label stays bold and readable over the fill. A small
orange corner marker remains for attention only; shift progress lives in the
pill. For scheduled arrangements, the companion's accessible name gives the
numeric percentage. Flexible arrangements keep elapsed time visible without a
scheduled fill, percentage, or countdown; follow the
[work-arrangement contract](profile-and-schedule.md#work-arrangements-and-fixed-day-flexible-hours).
The pill describes time only, never productivity or quality.

For every actionable prompt kind, use the shared `alert`
pose and the [attention sequence](#attention-sequence). That section owns
the bounded timing, snooze replay, and reduced-motion behavior.

Art uses the existing ink/paper/signal palette and never becomes a generic stock
illustration. Do not create a new raster asset where the configured original
asset can be referenced. Mascot motion is removed under reduced motion.

The one place raster art is required is the page-guide film ([page guides](page-guides.md)), and it is
allowed there for the opposite of decorative reasons: it is footage of this
product's own interface rather than an illustration of it, so a guide can show
where a control is instead of describing it. It is generated, never drawn,
and must match the current interaction. Apply the automated checks in
[performance budgets](../implementation.md#performance-budgets), review the
footage when instructions or filmed controls change, and re-shoot chapters
that no longer demonstrate the step.

The compact companion's drag handle is a visible, subtle dark capsule centered
above the mascot with a generous grab area. The ordinary handle is 72×30px and
the due-prompt handle is 78×30px, without covering the separate hide control.
The due-prompt mascot starts below the handle, including during its 6px attention
gesture.

A recap or due-prompt bubble floats in the strip above the figure. The mascot and
the elapsed-time pill keep their default positions whether or not a bubble is
showing: a bubble never pushes the figure down, so the pill can never land on
it. The bubble's copy clamps to the space above the head — headline and
supporting line stay legible, the action stays reachable — so a tall bubble may
temporarily cover the drag handle until it is resolved.

## Prompt destinations and dismissal

The collapsed companion's prompt bubble carries the day's current demand
(check-in, agenda, or EOD). Tapping the copy opens the chat; when the demand
has an obvious destination, a full-width action at the bottom of the bubble
goes straight there instead of making the employee type first: the EOD prompt
offers `Open EOD review` (the main window's EOD review page) and the agenda
prompt offers `Set today's goal` (the SOD `Plan your day` modal). Check-in
prompts keep the tap-to-expand behavior alone. The action never replaces the
tap target — both are one click away.

The prompt bubble and the expanded attention card each carry a dismiss control.
Dismissing silences that prompt for the local workday without hiding the record
behind it: the EOD draft, the focus editor, and the recaps tab stay reachable.
It re-arms on a genuinely new event: the next workday, a new plan revision for
the goal, or a newer recap watermark for the queue. Check-ins keep their snooze;
EOD, goal, and recap reminders are dismissible.

## Workspace-scoped attention

The floating companion's expression is scoped to the active workspace. The
employee ask is computed continuously but never drives the Administration orb;
Administration has its own idle state and its own attention state for a new EOD
submission or reviewed recap. Switching workspaces changes the pose, badge,
bubble, and expanded card immediately, and switching back restores the employee
prompt in the same state it was left, including an undismissed recap or goal.
The admin arrival uses the gold workspace accent in the compact bubble and a
quiet card above the thread or inbox; an OS toast used while the window is
hidden states only the count, never an employee name or record body. A new
admin or employee arrival switches the visible workspace once, for the newly
arrived event only; the state that was already waiting at launch never changes
the workspace by itself.

## Attention sequence

The floating companion starts a bounded three-play attention sequence when an
actionable prompt needs input: repeat the familiar quick movement during each
five-second active window, hold still for one second, then repeat twice. A
snoozed prompt replays the same sequence when it returns. The mascot then stays
still in its alert pose until the employee responds. Never loop continuously,
and remove attention motion under reduced-motion preferences.

**Existing snooze gap.** The real snooze handler and expiry effect in
[AvatarApp](../../../desktop/work-os-companion/src/AvatarApp.tsx) both advance
the counter. The first expiry after `Snooze 10 min` marks a still-required
check-in missed and skips the return/replay required above; the fixture starts
from a different counter value. Retain the replay requirement and verify the
real click-and-expiry path when repairing this separate implementation gap.
