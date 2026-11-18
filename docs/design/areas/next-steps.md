# Next-step suggestions after recap approval

**Use when:** Changing recap-derived task proposals, their durable chat cards, or compact decision bubbles.

**Owns:** Bounded proposal generation, explicit row decisions, recovery, and settlement.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing recap approval or evidence: [Activity interval reviews](recaps.md).
- Changing shared proposal frames: [In-app chat and shared tool cards](chat.md).
- Changing prompt placement or dismissal: [Floating companion, Otto, and assets](floating-companion.md).

**Implementation starting points:** [SuggestionReview.tsx](../../../desktop/work-os-companion/src/SuggestionReview.tsx), [AvatarApp.tsx](../../../desktop/work-os-companion/src/AvatarApp.tsx).

## Generation and durable chat moment

An approved recap (confirmed or amended) may also produce **next-step
suggestions** through the existing proposal pipeline — a reviewed recap is the
one recap state trusted to drive task actions. One bounded generation pass per
recap revision considers the approved recap (headline, detail, activity
bullets, recorded GitHub activity, uncertainties), the interval's evidence
snapshots, and the employee's open tasks and subtasks, and proposes at most
three suggestions of exactly two kinds: `complete_task` for an open
task/subtask the evidence shows as finished, and `create_task`/`add_subtask`
for a concrete deliverable the evidence shows that is not tracked yet. Every
suggestion must cite the recap activities it is based on and clear the
confidence floor; suggestions must be grounded in the recap's own activities,
so a failed or successful CI run by itself never becomes a task. A proposed
target must be a real open task/subtask from the list the model was given, and
a subtask suggestion carries the parent's current state, so fabricated ids
cannot file and approvals apply instead of going stale.

The moment lives in the **mascot chat**, not in a queue. After the employee
approves a recap, the panel lingers instead of returning to the orb: it shows
the receipt and a `Next steps` card (`From your <interval> recap`) with each
suggestion as an actionable row — `Mark done` / `Add task` / `Add subtask`,
plus `Edit` (inline title edit) and `Skip` for new work. Each decision files
through the same owner-scoped proposal endpoint as any other review card;
nothing is ever auto-applied, and a skipped suggestion is never re-proposed
for the same task and operation. The companion's EOD Review page renders only
the end-of-day flow: suggestions are never collected into a review queue
there, and no dashboard metric, sidebar badge, or stage count advertises one. The moment is part of the shared workday
conversation: it persists across reloads and renders in both the floating
companion and the in-app chat, and a cross-window sync can never drop a card
mid-decision (the local card wins when the incoming turn predates it). A turn
whose card was lost to an older build re-attaches from the server on load —
its entry id carries the interval — so pending suggestions are never stranded.
Once a moment has nothing left to decide — every item decided, or nothing
actionable — the panel settles back to the orb after about three seconds,
whether the moment was fresh or recovered; items still awaiting a decision
keep it open. The recap confirmation's success animation is staggered: it
plays on the orb only after the panel has closed (by the settle or a manual
close), so the celebration is actually seen instead of finishing behind the
next-steps card. If nothing is actionable the card says so quietly before it
closes. Ending the moment with items undecided dismisses them, and a 24-hour
sweep expires anything the client never closed, so suggestions never pile up.
Generation never blocks the recap decision, never writes check-ins or cadence,
and its outcome (`next_steps_status`) is recorded on the interval.

## Compact next-step bubble

**Next steps after approval.** Confirming a recap hands the same compact bubble
to the suggestions the confirmation generated; the panel never opens on its
own. While generation runs the bubble says `Working out what could come next`,
carries the reason (`Otto is reading your recap for anything worth doing.`), and
Otto keeps his working pose. The ready bubble leads with `Next steps` and the
source line (`From your … recap`), then one decision row per suggestion: its
kind (`Mark done`, `New task`, `Subtask`), the title, the evidence-bounded
reason, and that item's own accept, edit, and skip controls. Nothing is applied
in bulk and nothing is applied by opening the bubble; each control decides only
its row, and a failed row keeps its reason and a retry. Titles that can be
edited are edited in the bubble.

The compact window grows upward with the list, keeping Otto and the elapsed pill
in place; three rows fit, and a longer list scrolls inside the bubble rather
than moving the companion off screen. The scrolling edge is frosted — a soft
blur plus the bubble's own tint fading out — and appears only where more
content continues; the read prompter uses the same frost, and its top edge
waits until the track has travelled so the first spoken line is never under it.
The bubble eases in over a quarter-second, and reduced motion removes the
entrance, the frost transitions, and the slide. `Listen` reads the lead and each row's
title and reason with the same voice and one-audio-owner rule as the recap, and
the row being spoken is marked in place — the controls stay available while it
reads. The empty state says nothing needs action; a failed generation keeps its
reason and `Try again`. After the last row is settled the bubble shows the
result (`N changes applied · N skipped`), then Otto returns to the orb and the
success beat plays. A row that failed suppresses the success and stays
retryable. `Not now` hides the bubble but keeps the moment in the chat; the
chat card remains the durable record, and the bubble is only its front door.
