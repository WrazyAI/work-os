# Admin Otto tools and decisions

**Use when:** Changing admin chat reads, proposals, receipts, batches, or New chat.

**Owns:** Thread-native admin tool cards and explicit decision boundaries.

**Requires:** [Shared foundations](../foundations.md); [Administration shell and shared contracts](shell.md) (read each once per task).

**Read next only if:**

- Changing task-completion previews: [Parent and subtask completion](../patterns/task-rows.md#parent-and-subtask-completion).
- Changing shared chat frames: [In-app chat and shared tool cards](../areas/chat.md).
- Changing the view switch: [Floating companion, Otto, and assets](../areas/floating-companion.md).
- Changing recap follows: [Administration settings and recap follows](settings.md).

**Implementation starting points:** [AdminOttoChat.tsx](../../../desktop/work-os-companion/src/adminOtto/AdminOttoChat.tsx), [AdminToolCards.tsx](../../../desktop/work-os-companion/src/adminOtto/AdminToolCards.tsx).

## Admin Otto tools

**Admin Otto tools.** The administration chat uses one thread-native card family
for reads, proposals, and receipts: a paper frame, a clear header and lifecycle
marker, flat rows, and one action region. Its mascot/Admin chip opens the same
Employee / Admin view switch as the floating companion. Tasks, work records/EODs, reviewed
recaps, workdays, person resolution, and every task change each get their own
layout; a proposal never prints raw ids, an unchanged field, or a meaningless
empty value. Independent changes group into one review card with per-item
selection and receipts; a dependent change waits for its prerequisite and is
reviewed again before it can run. An uncertain result is never retried blindly:
the card checks its authoritative status first. `New chat` is explicit in the
sheet header, discards the thread, draft, and unconfirmed previews after the
server fences them, and never reverts recorded work.
