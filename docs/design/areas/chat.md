# In-app chat and shared tool cards

**Use when:** Changing the in-app launcher, chat sheet, tool cards, approval reviews, or message chronology.

**Owns:** The common chat language and bounded in-app conversation surface.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing task selection visuals: [Selection, hover, and focus](../patterns/task-rows.md#selection-hover-and-focus).
- Changing completion approvals: [Parent and subtask completion](../patterns/task-rows.md#parent-and-subtask-completion).
- Changing floating chat or view switching: [Floating companion, Otto, and assets](floating-companion.md).
- Changing microphone capture or hold-to-talk: [Voice input](voice.md).
- Changing the focus tab goal card: [Planning, focus, and suggested goals](planning-and-focus.md).
- Changing recap presentation: [Activity interval reviews](recaps.md).
- Changing admin tools: [Admin Otto tools and decisions](../admin/otto.md).

**Implementation starting points:** [WorkOsChat.tsx](../../../desktop/work-os-companion/src/WorkOsChat.tsx), [ConversationSurface.tsx](../../../desktop/work-os-companion/src/chat/ConversationSurface.tsx), [ToolApprovalCard.tsx](../../../desktop/work-os-companion/src/ToolApprovalCard.tsx).

Tool artifacts and chat are one language in the in-app and floating surfaces.
The latest bounded launcher/sheet implementation on main is the authority for
chat geometry; dashboard work must not regress it.

## Tool-call surface frame

Every tool surface uses one warm-paper frame:

1. clear header and lifecycle marker;
2. one content region;
3. one action or receipt region.

Do not nest a bordered card for every row. Task selection, approval, action
results, batch review, navigation, thinking, and tool-call variants share the
same spacing, border, focus, and receipt language while keeping their distinct
approval contracts.

The live working card is the shared frame for every wait in both chats. Its
header carries the 34px status tile, the 10px `Working now` eyebrow, the 14px
active label, the tabular elapsed time, and one disclosure; the body shows the
current step at 13px with the shared spinner, and the steps already done
underneath at 12px with muted checks. The same card carries the request itself
(`Sending your update`), the interpretation (`Thinking`, `Reviewing your
agenda`), and task loading (`Loading tasks`), and it settles into the collapsed
`Completed` receipt. The card owns the full assistant turn — no separate mascot
mark beside it — and the full trace remains available through the disclosure.

Tool surfaces must preserve:

- explicit approval before mutations;
- truthful queued/recorded/failed/skipped states;
- per-item results for batches;
- internal scroll for long task lists;
- clipped task and subtask titles that reveal on the row's hover or focus ([task rows and readable overflow](../patterns/task-rows.md#clipped-text));
- keyboard reachability and visible focus;
- reduced-motion behavior;
- copy controls that do not crowd the message bubble.

An approval batch is reviewed one action at a time. The card's top edge carries
the batch progress rule, the header names the action with its position (`N of
M`), and the footer keeps the quiet step arrows beside the two decisions on one
compact row at every width — content-sized decisions that wrap beneath the
arrows only when the card is genuinely too narrow — so nothing in the card
reads heavier than the action being decided.

## In-app launcher and sheet

The closed in-app state is a compact Otto launcher fixed to the lower-right
viewport corner and outside page flow. It never leaves an empty input shell
behind or consumes task-list space.

The open state is a bounded white sheet, approximately 480px wide and 680px
tall at desktop, with safe insets on narrow screens. Header, thread, and
auto-growing composer are one coherent surface. The composer row carries only
the add menu, the field, and the send/record control; the day's goal lives in
the Focus tab rather than as a third control in the row, and the placeholder
fits on one line at the sheet's width. The thread is the only scrolling
region on the chat tab. The sheet closes on Escape and returns focus to the
launcher.

## Message times and session dividers

Both chat surfaces state when a reply arrived. Hovering or focusing an agent
turn reveals its local 12-hour clock time at the right edge of the reveal row,
after `Copy` and any destination action, so the row reads `Copy`, action, time.
Employee bubbles reveal no hover time; their sent time is the session divider's
job. A turn with no recorded timestamp shows no time and is never assigned one.

A centered divider labels the conversation's opening employee message and every
employee message that follows the previous turn by more than twenty minutes.
The label is the relative day plus the local 12-hour time — `Today 5:48 PM`,
`Yesterday 9:03 AM`, `Wednesday 9:03 PM`, `September 30, 5:48 PM` — derived
from the same recorded timestamps the turns persist. Dividers live in the
thread (not hover- or motion-driven) and stay for the life of the conversation;
clearing the chat clears them. Both surfaces render the shared conversation, so
the dock and the floating window always agree.
