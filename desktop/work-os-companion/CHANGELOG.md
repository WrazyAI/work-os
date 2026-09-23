# Work OS Companion changelog


An employee reads this right after installing an update, so every entry is
one short, plain bullet: what changed for them, in their words. No jargon,
no file names, no implementation detail. One bullet per change, one line per
bullet, each under ~160 characters.

- Lead with the outcome: `Downloads now resume after a failed update.`
- Name the action the employee takes, not the system that changed.
- Longer notes are only for a complex change that cannot be understood in
  one line — a new workflow with steps or a behavior change with conditions.
  Even then, lead with the one-line version first.

Every release adds one `## <canonical-version>` section below. Versions stay
in canonical SemVer here (`0.3.9`, never the padded display form `0.3.09`);
the UI pads the patch segment for display. **Updating this file is a hard
release requirement: the release workflow fails when the released version
has no matching section with at least one bullet**, and the GitHub release
notes are built from that section. While work is in flight, collect entries
under `## Unreleased`; when cutting a release, move them under the new
`## <version>` heading. Omit refactors, chores, and internal tooling unless
they change what the employee sees or does.

## Unreleased

- Otto now nudges for five seconds, pauses for one, then repeats twice when an update needs your input; the halo is gone and the orange corner marker stays.

## 0.3.53

- Your floating companion now shows elapsed shift time and an orange circle that fills with scheduled progress.

## 0.3.52

- Tasks now keeps date navigation in the masthead, puts Add task beside search, and lets you edit or remove subtasks from their action menu.

## 0.3.51

- Modal windows now keep the page and navigation still while you scroll inside the open window.
- Notification flyouts no longer flash scrollbars or leave heavy block shadows when stacked.

## 0.3.50

- The floating companion now uses one clearly labelled collapse control, while the compact mascot keeps the separate hide action.

## 0.3.49

- You can now build today's plan directly from a Loom recording without writing a separate planning note.
- The daily planning window now makes Loom link, transcript, and review steps clearer.
- Floating Otto now shows the full figure, real shift time and progress, and stepped body gestures when work or attention changes.

## 0.3.48

- Chat threads now fade smoothly into the header and composer while staying in one bounded surface.
- Floating companion Chat and Tasks now share one compact header row.

## 0.3.47

- Collapsed sidebar labels now stay readable above dashboard cards when you hover a navigation icon.

## 0.3.46

- Studio Otto now appears in the My Day readiness hero and active workday header.
- Dashboard and floating Otto now follow the same activity and workday states.
- The scenario debugger can now exercise every mascot state, reduced motion, and recovery sequences.
- Mascot previews reset with scenario mode and never write real receipts.
- The active workday summary now keeps Review unfinished work in a clear, padded footer.

- Settings now uses larger category headings and removes the extra descriptions between the page title and controls.

## 0.3.45

- The floating companion now waits long enough for a full AI update instead of stopping at 20 seconds while the assistant is working.

## 0.3.44

- Otto now uses a retro-terminal companion design with clear idle, working, input, ready, and blocked states.
- The floating companion and chat marks now share the same Studio Otto identity across light, dark, and reduced-motion views.

## 0.3.43

- The main and floating chats now open with a clean, first-name welcome that helps you start an update without a mascot in the hero.

## 0.3.42

- Profile settings now let you change scheduled days, clock-in and clock-out times, and break windows used by Work OS.

## 0.3.41

- The sidebar now stays focused on workspace navigation, with the retired empty chat-history rail removed.
- Collapsed navigation now expands from the workspace mark or empty rail space, while Settings stays anchored at the bottom.

## 0.3.40

- Profile settings now open in a dedicated personal view, keeping the main Settings page focused on companion controls.

## 0.3.39

- Clicking a task now opens a full-height detail panel, and unfinished work uses the same clear overlay without trapping you inside the task list.

## 0.3.38

- The companion now opens with a cleaner collapsed sidebar that expands when you need workspace names, chat history, and navigation labels.
- The same sidebar now appears in the design previews, with clearer active states, session status, chat search, and workspace actions.
- Connecting a new workspace now starts with a calmer, clearer screen and a labeled server setting.
- Profile settings now let you update your name, photo, workday preferences, notifications, privacy exclusions, and work profile from the companion.

## 0.3.37

- The Today view now separates readiness, active time, observed activity, and task flow into a clearer workday command center.
- Tasks now use a calmer, denser workspace with truthful counts, overdue grouping, row-level progress, and a focused detail drawer.
- Dashboard and task selection surfaces now use a stable neutral treatment instead of a distracting colored rail.

## 0.3.36

- The in-app chat now rests as a compact Otto launcher and opens into a bounded sheet without covering your task list.
- The floating companion now fits its window, keeps the composer growing with your draft, and opens context menus reliably.
- Chat review cards keep one clear copy action and remain usable near the window edge.

## 0.3.35

- Batch task cards now show live filed, skipped, and needs-attention results, keep edits safe, and collapse into a clear receipt after approval.
- Batch cards now use the full compact width in the floating companion instead of squeezing titles and steps into a narrow strip.

## 0.3.34

- New tasks now use Work OS directly, so assignee choices and task saves no longer depend on Nifty.

## 0.3.33

- Checking off a task no longer makes the list jump while it saves: the checkbox spins in place and the finished row leaves in one smooth motion.
- Adding a task draws it straight into the list without the rows sliding up and down while the server confirms it.

## 0.3.32

- Opening the companion no longer gets stuck behind a copy left over from an earlier session — it clears the dead one and starts.
- If the app ever fails to open again, it now records the exact stage it stopped at so the cause can be found.

## 0.3.30

- Chat now uses one calmer, roomier layout in the app and floating companion, with clearer copy controls and Otto markers.
- The plus menu now opens reliably in the app and lets you add Work OS context just like the floating companion.

## 0.3.29

- Checking off a task now shows a spinner in that checkbox, keeps the rest of the list usable, and removes the task right away — no refresh needed.
- The task list and the dashboard both drop a finished task the moment it is done; the Completed view keeps its record.
- Subtask progress is now a small animated ring with its fraction, the same on task rows, dashboard cards, and the day header.
- Adding a task draws it into the list immediately, and the add-task window closes with a smooth animation.
- Cleaned up the task rows: the redundant "Open" label is gone and columns line up the same way on every row.

## 0.3.28

- The task list no longer scrolls or jumps while you write in the update bar.

## 0.3.27

- Approved and skipped task batches now collapse into a short summary with no buttons, so a card can never be approved twice.
- Every task on a batch card now says what it does — New, Edit, or the old and new status for a status move.

## 0.3.26

- Pending task lists now show the newest tasks first, so recent work no longer sits underneath older items.
- Finished history can no longer crowd the pending list out of view.
- Checking off a task no longer leaves an empty "No pending tasks" card or repeats the action summary.
- The Overdue list shows the oldest due dates first again.

## 0.3.25

- Otto can now archive, delete, log progress on, or hand over several tasks at once, and can import a whole task template in one go.
- Every batch still shows on one card, asks before removing anything, and reports what happened to each task.

## 0.3.24

- You can now ask Otto to add several tasks and their steps in one go, or to update a batch of tasks, and review the whole change on one card.
- Batch cards can be edited before you approve them, approve in two steps, and report what happened to every task and step.

## 0.3.23

- Task lists now open sorted by due date, latest first, with open work above completed work.
- The Activity sort option is gone; Task, Status, Due, and Priority remain.
- The dashboard's older-work count no longer includes tasks that are already on today's plan.
- Unfinished now shows your complete open backlog, including longer-running projects, with exact counts.

## 0.3.22

- Your end-of-day activity summary now reads one line per hour — “3–4 PM: …” — instead of listing every screenshot.
- Times and dates read plainly (3:04 PM, September 17, 2026), with no timezone shorthand anywhere.
- Loom links work when pasted without https://, and a recording from another day can’t stand in for today.
- The screenshot section no longer stretches the report, and the waiting screen matches the composer while your day is prepared.

## 0.3.21

- First launch after an update announces itself, with a View changelog action.
- Updates wait out antivirus scans instead of closing, and a failed install offers Retry.
- Task lists name their order, sort from real column headers, and every count now matches the rows it describes.

## 0.3.20

- The scenario debugger now marks the preset you loaded and says when you have changed it, and asks before live writes reach the real server.
- You can copy the current scenario as JSON, follow the live trace and copy what is shown, and see the diagnostics export result in the panel.

## 0.3.19

- The Update and Focus switches in the chat header sit side by side again, with the one you are on clearly highlighted.
- The assistant's chat badge now shows Otto's face properly, filling its circle instead of spilling over your messages.
- A reply keeps its task card when the app restarts, and the same reply no longer shows up twice.
- Chat has more room to breathe: roomier message spacing, taller task rows, and slightly larger text.

## 0.3.18

- The What changed window can now show every earlier release, newest first, through a Check older updates action.
- The scenario debugger is tidier and says at a glance when a scenario is on, running offline, or writing to the real server.

## 0.3.17

- Settings are back to two columns with thin dividers, so the page reads as one calm surface instead of a stack of white boxes.
- On the Desktop updates row, Check and What's new now sit together.
- The What changed window shows the release notes again for recent updates.

## 0.3.16

- Settings are calmer to read: rows sit on the page with thin dividers instead of each one being its own white box.
- What Otto remembers is a flat section too, so the whole page reads as one surface with only the facts awaiting your decision in cards.


## 0.3.15

- Paste a Loom link in an update and Otto can read the recording to suggest tasks — the recording never stands in for the update itself.
- Recordings are checked against the day they were recorded, so an older Loom can't be used as today's work.
- In the EOD composer, a Loom recording can shape the draft on its own without a second report.
- The transcript box on Loom cards stays tucked away until you want it.

## 0.3.14

- What Otto remembers is now three clear lists: what is waiting for your review, the facts you kept, and the recent activity behind them.
- Every memory shows a plain date, and you can forget a fact or a memory right from its row.
- Settings are grouped by what they affect, with a separate Reset section, and the on/off toggles show their state in words.

## 0.3.13

- Every chat message now has a Copy button that appears when you hover over it, including the short receipt lines.
- The assistant now shows Otto's mark in chat instead of a generic sparkle, and its art comes from one setting so a mascot change lands everywhere at once.
- Chat spacing is even throughout: the message list, task cards, and action results share one rhythm instead of three.
- The selected count and the collapse control sit together on one line again, and action results show their full label without being cut off.

## 0.3.12

- Checking off tasks no longer hides the rest of the list — keep selecting as many tasks and subtasks as you need before you confirm.
- Checking a task that has subtasks now opens them right away, so you can tick those off in the same pass.
- Action results collapse to a short "N actions recorded" line you can open, and they open on their own when something failed so the error and Retry stay visible.
- The same task list no longer appears twice when the assistant returns it twice.

## 0.3.11

- The Tasks page shows its title once, and the day's focus, view chips, and unfinished-work link sit together on one tidy row.
- Task rows keep their "On today" tag beside the title, and the checkbox lines up with the title where you expect it.
- The task list reads as one clean panel, and narrow windows keep every row a single line tall.

## 0.3.8

- A new task that may already exist no longer gets stuck: confirm nothing was created, then file it once.
