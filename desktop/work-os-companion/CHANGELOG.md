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

## 0.4.13

- Work OS now keeps a settings file on your computer, so you can change your check-in timing for that machine only.
- It is created the first time you run this version from your workspace settings; edit it and the change applies next time you open the app.

## 0.4.11

- Debugger can replay the current page guide without changing first-visit guide state.

## 0.4.10

- EOD reports are simpler: no bottleneck reason is required to submit, and the review header is cleaner.

## 0.4.9

- A suggested next step now always finishes: if the change applied, the card shows Added instead of staying on Saving.

## 0.4.8

- The bell now opens a notifications panel with everything that needs you: memories to review, a ready recap, and outstanding EODs.
- When Otto remembers something new or a recap is ready, a reminder with Otto's mark pops up — and a system notification appears if Work OS is minimized.
- Settings has a new Suggestions waiting for review section: approve, retry, or dismiss task changes that were never decided.

## 0.4.7

- The EOD review button now reads “Draft today’s EOD”.

## 0.4.6

- The EOD review button now reads “Drafts today’s EOD”.

## 0.4.5

- Review cards are simpler: each one shows the action to decide, with technical details tucked away and no repeated explanation.

## 0.4.4

- The EOD Review page now shows only your end-of-day report; the old suggestions queue and its counters are gone.

## 0.4.3

- Selecting multiple tasks keeps the list reachable, and new chat replies remain visible as they arrive.

## 0.4.2

- Closing a page guide now keeps it dismissed when you return, including after account sync.
- Page guide illustrations now play once and respond to each numbered step, while reduced-motion stays still.

## 0.4.1

- The companion is now available for Intel and Apple Silicon Macs; use Worktivity on your Mac for clock actions.

## 0.4.0

- Each page now explains itself the first time you open it, with one short illustrated guide.
- Open any page's guide again from the question mark in the header.
- Turn automatic page guides off in Settings, or from the guide itself.

## 0.3.99

- Press Ctrl + , anywhere in Work OS to open Settings.
## 0.3.98

- When your EOD is due, the companion bubble now has an Open EOD review button, and the morning bubble has Set today's goal.

## 0.3.97

- Suggested next steps now close back to the mascot after about three seconds, and the success animation plays once the window is closed.
- Selecting tasks in the floating chat keeps the card steady and its actions clear above the message bar.
- Moving from your written goal to its draft and recorded confirmation now feels smoother.

## 0.3.96

- Suggested next steps that were lost to the earlier sync now come back when the companion opens, scrolled into view.

## 0.3.95

- Recap evidence now keeps GitHub activity with its screenshot count inside one disclosure.

## 0.3.94

- Your suggested next steps now stay in the chat instead of vanishing after the conversation syncs, and they are also visible in the app chat.

## 0.3.93

- After you approve a recap, the chat stays open and shows suggested next steps — mark a task done, add a task, or add a subtask.
- The next-steps suggestions are no longer mixed into the Review page.

## 0.3.92

- Confirming a recap that opened the companion on its own returns the chat to the mascot moments later.
- The celebration after you confirm a recap lasts twice as long.

## 0.3.91

- Approved recaps now link their suggested next steps into Review, where you can approve or skip each proposal before anything changes.

## 0.3.90

- The companion window now drags from the whole header, not just the tab strip.
- The elapsed-time label sits just under the mascot and follows the mascot size setting.

## 0.3.89

- Late-start reasons, missed clock-out corrections, and task changes saved offline now say they are waiting to sync.
- Confirming your plan from the floating companion no longer overwrites a plan you changed in the app.
- Signing out clears the companion's reminder and snooze state so the next person on this device starts fresh.

## 0.3.88

- An EOD submitted while offline now says it will sync instead of claiming it is already with your manager.
- A day whose report is already submitted no longer invites another draft from the EOD list.

## 0.3.87

- Submitting your plan or EOD now closes with a checked confirmation animation instead of a receipt line.
## 0.3.86

- Activity recaps now show what GitHub recorded for the interval — commits, pull requests, CI runs, and deployments — tagged by what you did vs. your work.

## 0.3.85

- Update prompts keep coming even after a download you haven't installed yet.

## 0.3.84

- The plan's done-when list now shows a bullet on every line, and the Loom section's remove action is a trash icon.

## 0.3.83

- The companion stops asking what you are working on once you have recorded work for the day, and its planning bubble no longer repeats the question.

## 0.3.82

- Ctrl + M now starts recording even if you press it while the previous note is still being transcribed, instead of appearing to do nothing.

## 0.3.81

- Insights charts now connect weekly plan progress, show an interactive app/site distribution, and reflow the daily breakdown cleanly on smaller windows.
- Otto in the floating companion stays awake whenever Worktivity confirms you are working, even before Work OS mirrors the session.

## 0.3.80

- Ctrl + M records in the active window — the app when focused, the floating companion otherwise — without pulling the app over your work.

## 0.3.79

- The Today's Focus card now gives its progress bar and legend proper room, even when your focus statement wraps to several lines.

## 0.3.78

- Drafting your plan no longer fails when you carry a long task list forward.
- A plan save that didn't go through now clears once a newer save succeeds, instead of lingering in Needs attention.

## 0.3.77

- The planner now opens your drafted plan in its own view, with a back button to return to the brief and a Review draft action to move forward again.
- The planner no longer shows the extra helper lines under the brief and the Loom section.

## 0.3.76

- Insights now lead with outcomes, commitment reliability, closing backlog, and source health, with exact daily data tucked into a breakdown.

## 0.3.75

- Editing a planned task or its "done when" lines no longer jumps your cursor back to the start of the sentence.

## 0.3.74

- Profile settings now use the same calmer hierarchy as the main Settings page, with cleaner sections, flatter schedule controls, and a more focused save area.

## 0.3.73

- The microphone only appears when the workspace can actually transcribe, and a slow transcription now says so instead of failing silently.
- Recap messages now show an All recaps button beside Copy that opens the Tasks tab with your full recap history.

## 0.3.72

- The recap bubble now sits directly above Otto’s head at any mascot size, with its tail pointing at him.
- Only the latest undecided recap stays in the chat — older recaps remain in the Tasks tab.

## 0.3.71

- Activity recaps now read as a short lead with scannable bullets, a flow line, and an explicit list of what the screenshots did not establish.

## 0.3.70

- The plan window no longer pops up when you open the app if your agenda is already set.

## 0.3.69

- The floating companion no longer opens the chat on its own — a bubble above Otto shows your recap when it’s ready, and View more opens it in the chat.
- While your recap is being analyzed, Otto shows his working state instead of asking for input.
- A recap now stays in the chat until you confirm or correct it, and View more opens the chat at the latest recap.

## 0.3.68

- Loom recordings now bring their own transcript into your plan and EOD draft — no copy-paste needed.
- Hold Ctrl + M anywhere to record a voice update — release it and what you said is typed into the update box.
- The update box shows a microphone while it is empty. Tap it to record instead of typing, and tap stop to finish.
- A voice update is only ever typed into the box, never sent: check it, edit it, then send it yourself.
- Settings has a Hold-to-talk switch, and says so honestly when another app already owns Ctrl + M.

## 0.3.67

- The floating companion no longer leaves its "What are you working on today?" reminder in the chat after your plan is set.
- Progress check-ins keep their own rhythm: a due check-in is no longer held back while your plan is being confirmed.

## 0.3.66

- Your activity recap in chat now asks “Sounds good?” — tap Looks good to confirm it, or Edit to correct it yourself in the chat box.

## 0.3.65

- Work OS now notices when Worktivity starts or ends your workday and updates the dashboard within a minute — no manual refresh needed.
- While it waits for your activity, the dashboard says "Checking your activity…" and you can still clock in, pause, or clock out yourself.

## 0.3.64

- Settings is calmer and easier to scan, with simpler copy, aligned controls, and cleaner section spacing.

## 0.3.63

- When Otto is set to Small, the floating drag handle and hover close button stay tucked near his head.

## 0.3.62

- Resting Otto’s deep-blue sleep Zs are larger and easier to notice.
- The compact drag handle and hover close button now sit closer to Otto without getting any larger.

## 0.3.61

- Settings has a new Reading & display section: choose Small or Medium text to make the whole app easier to read.
- You can also set Otto to Small so he takes up less room everywhere he appears, including the floating companion.
- Both display choices apply straight away and are remembered on this device.

## 0.3.60

- Otto can use memories inferred during the day as temporary context for that day without treating them as saved long-term facts.
- The Focus tab now scrolls with the same soft edge fade as chat, so the goal and long activity lists stay reachable.
- The dock's Agenda tab is now called Chat, matching the floating companion.
- New chat uses the same pen icon in the dock and the floating companion.
- Settings shows memory as a compact summary with a View button; facts open in a two-tab window to keep or forget.
- Clicking a subtask title opens its editor, and the subtask action menu now stays open until you choose an item.
- Floating check-in prompts are larger and easier to read.
- Otto’s drag handle is smaller, and the white status bar under him is gone.
- Resting Otto now shows slow deep-blue Zs.

## 0.3.59

- The Focus tab now lists your interval check-ins beneath the daily goal, with the screenshots behind each one.
- The floating Tasks tab's Recent activity header has a View in app button that opens the Focus tab in the main window.

## 0.3.58

- The Focus panel now shows your goal as a card with an edit button once it is set, and saves only when you press Apply.
- Setting your first goal of the day now opens the same plan builder as shift start, so it can create your tasks and subtasks.
- Editing a goal you already set only updates the wording; it never creates tasks or subtasks.

## 0.3.57

- Check-ins now start with a recap of your last work interval: review it, confirm it, or add anything missing.
- The Tasks tab shows your recent activity recaps, and expanding one reveals the screenshots behind it.
- Recaps stay marked Not reviewed until you decide, and the screenshots behind them are kept for 30 days.
- Tasks now has sortable Name, Date due, and Status columns so you can reorder the full task list without losing your place.

## 0.3.56

- Otto now repeats its quick alert motion for three five-second bursts, with a one-second pause between bursts.

## 0.3.55

- The Windows Companion now controls Worktivity clock in/out and pause/resume, restarting an app it cannot control and waiting for provider confirmation.
- Snoozed check-ins replay all three attention nudges when they return; Otto then stays still until you respond.
- The floating companion’s drag handle is 50% larger and centered, clear of the hide control and mascot.

## 0.3.54

- Otto now repeats input-needed nudges three times, with a one-second pause; the orange alert dot remains without the halo.

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
