# Floating Otto employee / administration view switch

Date: 2026-11-05
Status: approved direction; implementation plan pending

## Intent

An administrator already has two Work OS views — their own workspace and
Administration — but the floating companion only speaks as Employee Otto. The
mascot in the floating window's header becomes the single place to switch both
the open window and the app between the two views. Each view gets its own real
conversation, and Otto visibly belongs to the view he is in.

The in-app Administration Otto sheet and the floating companion must render the
same administration conversation and reuse the same cards, confirmation,
New chat, audio, and provenance behavior. They are two windows onto one
capability, not two products.

## Goals

- One Employee / Admin switch reachable from the mascot at the left of the
  floating Otto header and from the mascot in the in-app Administration Otto
  header.
- Switching swaps the floating conversation to the matching real conversation
  and switches the main companion window to the matching workspace.
- A switch made anywhere (main workspace switch, in-app Otto, floating Otto)
  converges in both windows.
- Admin Otto in the floating window reuses the existing administration chat
  engine and cards. No second admin implementation.
- Otto wears a blazer and spectacles in Administration across every existing
  pose and animation, including the collapsed orb.
- The collapsed orb plays a one-shot tailoring transition when the view
  changes: blazer settles, spectacles fold into place; removing reverses it.
- The view is obvious while the chat is open without adding a second brand.
- Reduced motion preserves the final dressed state and removes the flourish.

## Non-goals

- A second, independent administration mode for non-administrators.
- Changing server authorization, scopes, preview/confirm rules, or the admin
  API surface.
- A general theme switcher or two differently branded products.
- New Tauri commands or ACL grants.
- Reworking the employee floating chat's conversation model.
- A web-workspace mode switch; the web already has its own view switch.

## Anti-goals

- A toggle that changes only the floating chat while the app stays on the other
  workspace.
- An admin chat that silently falls back to employee data, employee mutations,
  or a different confirmation path.
- Faking an admin view for an account that cannot open Administration.
- Losing an in-flight conversation, draft, or preview merely because the window
  swapped views.
- A permanently animated costume, or accessory art that covers the face,
  controls, or status.

## User-visible behavior

### The switch

The mascot at the far left of the floating header is a button. It opens a small
popover anchored beneath it with two choices:

- **Employee** — the administrator's own workspace, with their employee
  conversation.
- **Admin** — Administration, with the administration conversation.

The current choice is marked in text and shape, not color alone. The popover
also states the current view in its accessible name. While a switch is pending,
the chosen row shows a bounded pending state and both rows are disabled. A
failure stays inside the popover with one retry and leaves the current view
unchanged.

The same mascot/button and popover appear at the left of the in-app
Administration Otto header. For an administrator on the Employee side of the
main window, the floating header is the available switch; no new mascot is
added to the employee web-style masthead.

For a non-administrator the mascot stays as identity and the switch is not
offered. For an administrator without a mapped personal workday, Employee is
visible but disabled with the reason `No personal workday is mapped.` For an
administrator whose administration context is still loading, Admin is disabled
with `Loading Administration…`; after a failed context read, Admin says
`Administration is unavailable.` The existing New chat entry remains
independent of the switch.

### Switching

Any switch follows the same sequence:

1. Validate the destination against the signed-in account and the current
   authoritative context.
2. Fence/stop the old view's audio, microphone, and pending chat work before the
   visible mode changes.
3. Switch the main workspace and persist the per-device workspace preference.
4. Publish the new mode scope and epoch to the floating window.
5. Open the matching conversation surface; hydrate it from the server.

The main window is the source of truth for the selected view. A request from
the floating window is a request to main, not a local mode flag. If main
refuses, the floating window stays where it is and says why.

The view selection does not create an authorization boundary. Every admin read
and write still goes through the existing admin authorization and session-bound
confirmation routes.

### Conversations

Employee mode keeps the existing floating conversation store, prompts, tasks,
recaps, and local persistence.

Admin mode mounts the existing `AdminOttoChat` conversation logic and card
family in a floating variant. Its conversation id is shared with the in-app
Admin Otto sheet for the same account, scope, and epoch:

- A conversation opened or created in either window becomes the current
  conversation id in the other.
- New chat runs the existing server fence before the id is cleared, and both
  windows adopt the cleared id.
- Scan late responses after a switch or New chat are discarded by the existing
  scope/epoch fences.
- The server remains the only source of message history; no conversation text
  crosses the window bus.

Record destinations from a floating admin result open the Administration record
in the main window through a presentational navigation event. Main validates the
URL with the same `parseAdminRecordHref` seam before navigating. Reviewed recap
plays use the same admin audio owner and cross-window lease, not a second audio
player.

### Visual state

The open header states `Employee` or `Admin` next to Otto. The admin header uses
an ink chip with a small brass pin as its static state cue; the employee header
keeps the current shift/status copy. The chip is text, not decoration alone.

The switch itself is a quiet 36px mascot button inside the existing header
rhythm. Its popover uses the shared raised surface, 12px radius, hairline, and
product easing. The header surface crossfades over roughly 220ms when the view
changes; there is no permanent admin gradient or second palette.

### Outfit

Administration adds two SVG accessories rendered by the configured mascot
renderer, never by surface-specific art:

- a charcoal blazer with an open front, narrow lapels, a signal pocket square,
  and a small brass lapel pin. The chassis controls remain visible.
- thin brass spectacles over the screen, with transparent lenses and a bridge
  that respects every pose's face.

The accessories are part of the mascot, so every existing pose and animation
keeps them. Head crops show the spectacles and collar; full crops show the full
outfit. No new raster asset is introduced.

### Costume transition

The collapsed orb owns the one-shot transition:

- Employee → Admin: the jacket settles from the shoulders over ~280ms, the
  lapels close, and the spectacles fold down over ~220ms after a short beat.
- Admin → Employee: the spectacles lift away and the jacket opens and recedes.
- The transition runs once, settles on the final frame, and never loops.
- Opening or collapsing the window does not replay it.
- Under reduced motion, the final state appears immediately with no movement.
- The orb gains a compact `Admin` label while in Administration so the state is
  readable without relying on the costume.

The in-app and header marks render the final accessory state without playing the
orb transition.

## Architecture

### Shared view contract

Reuse `OttoMode` and the existing `OttoModeSnapshot` as the view vocabulary.
Do not add a second employee/admin boolean.

Main publishes one presentational view snapshot to the floating window whenever
the workspace, role, context readiness, capabilities, or conversation identity
changes, and on the existing visibility heartbeat:

```ts
type OttoViewState = {
  scope: OttoScope;              // current actor/org/mode, or the selected mode
  epoch: number;
  workspace: "employee" | "admin";
  role: "admin" | "manager" | "employee";
  adminStatus: "loading" | "ready" | "failed" | "absent";
  personId: string | null;        // opaque mapping
  employeeAvailable: boolean;
  adminAvailable: boolean;
  voiceAvailable: boolean;
  transcriptionAvailable: boolean;
  adminConversationId: string | null;
};
```

`OTTO_VIEW_STATE_EVENT` carries this snapshot. It is emitted even while the
administration context is loading or failed, so the floating window can follow
the main workspace and say what is unavailable instead of falling back to the
wrong view. It carries no conversation text, token, record, or provider data.

`src/adminOtto/mode.ts` also gains a request/result pair:

- `OTTO_VIEW_REQUEST_EVENT` — `{ requestId, scope, mode }`
- `OTTO_VIEW_RESULT_EVENT` — `{ requestId, scope, mode, accepted, reason? }`

The request carries the sender's adopted scope so main can reject a stale
account/organization, not just a stale mode. Main also validates the mode
against the current session and administration context, calls the same
workspace switch used by the shell, and republishes the view/context events on
success. The result is only for the initiating window's pending/error state.
Browser DEV may bridge these non-secret events through the existing preview
allow-list.

A small pure module owns the availability and pending-state decisions so both
windows and tests use one rule:

- `admin` is available only for an admin with a ready administration context.
- `employee` is available only when the administration context is ready, the
  account has a mapped person, and the context is not blocked. This matches
  `planAdminOttoBootstrap.switchToEmployeeAvailable`; the switch never offers a
  destination the shell refuses.
- the active side comes from the authoritative workspace/mode snapshot.
- a request is bound to one scope and is ignored after the scope changes.
- if main sits in Administration because its context failed, the floating
  window shows Administration's unavailable state with the switch disabled and
  one retry path. It never silently shows Employee Otto under an Administration
  main window.

### Main window

Refactor the existing `setWorkspaceMode` validation into a callable
`requestWorkspaceMode(next): { ok: true } | { ok: false; reason }` and keep the
current UI call sites as thin wrappers. This returns the same
no-person/administration-context refusals the shell already shows.

Add one listener for `OTTO_VIEW_REQUEST_EVENT` that:

1. verifies the request scope matches the current account/organization and that
   the mode is known;
2. calls `requestWorkspaceMode`;
3. emits `OTTO_VIEW_RESULT_EVENT` with the accepted/current mode or reason.

Publish `OTTO_VIEW_STATE_EVENT` from an effect that depends on the live
workspace, role, admin context status, session person mapping, voice and
transcription capabilities, retained admin conversation id, and view epoch.
Publish it directly on each change and on the existing 30-second late-listener
heartbeat; do not derive it from `adminOttoSnapshot` alone, because the shell
must still describe an Administration view whose Otto context failed.

Change the existing mode-switch cleanup so it closes the visible admin sheet but
keeps the retained conversation id and draft on an Employee switch. Disposal for
sign-out, account replacement, or unmount still clears them. Add one listener
for the admin record navigation event; validate through the existing parsed
record seam and navigate in main.

### Floating window

`AvatarApp` derives the visible view from `OttoViewState.workspace` (employee
by default, admin only after main publishes it). In employee mode the existing
body renders unchanged. In admin mode the expanded shell replaces the whole
employee panel with the shared `AdminOttoChat` floating variant. There is one
header, one tab row, one New chat, and one collapse control in each view; the
admin variant owns the drag region, Admin chip, switch slot, and collapse
behavior.

The floating switch calls `requestView(mode)`, emits the request event, shows
pending, and waits for the result or a matching view state. It never sets a
local mode optimistically.

`AdminOttoChat` gains:

- an optional `surface: "in-app" | "floating"` presentation prop;
- an optional `headerLeading` slot for the shared mascot switch;
- optional floating drag/collapse callbacks;
- shared conversation-id callbacks already used by the in-app shell.

The floating variant overrides only geometry, drag, and close behavior (collapse
the window); behavior, cards, composer, recaps, confirmation, audio, and New
chat stay one implementation.

Admin conversation identity is synchronized in two ways:

- `OttoViewState.adminConversationId` is a full snapshot, so a window entering
  Administration learns the current id even if it ignored change events while
  in Employee mode.
- `OTTO_CONVERSATION_EVENT` — `{ scope, epoch, conversationId }` announces a
  change while both windows are on Administration.

Both windows ignore an event whose scope/epoch is not current. The server thread
is fetched by `AdminOttoChat`; message bodies never travel over the bus. On
window focus, an open admin conversation refreshes its thread.

Switching views preserves the administration conversation id and the in-app
draft. It closes the visible sheet but never discards recorded work or a prepared
message; only New chat, sign-out, or an account change clears them. The floating
window keeps its own draft locally across collapse/expand and view changes; the
two windows share the conversation identity, not in-progress composer text. A
fresh epoch republishes the retained id so the returning surface can hydrate it.

### Mascot renderer

`mascotTypes.ts` gains `MascotMode = "employee" | "admin"`.
`MascotRendererProps` gains `mode`.

`StudioOtto` always renders the accessory groups and sets `data-mode` plus a
short-lived `data-attire-transition` state:

- blazer and spectacles are inert in employee mode;
- admin mode moves them to their final transforms;
- the renderer does not own timers; `MascotPet` gives it the transition state.

`MascotPet` detects a runtime mode change, sets the transitioning flag for one
bounded interval, and passes the mode through. Its existing reduced-motion state
turns the transition off. `MascotMark` accepts the mode and renders the final
state, so chat marks and notifications are correct without motion.

All surfaces receive mode from one source: the adopted view/scope in the shell,
not from individual cards.

## States and edge cases

- **Administration context loading:** current view remains; Admin disabled;
  switch never guesses readiness.
- **Administration context failed:** current view remains; Admin disabled with
  retry copy; no raw provider error.
- **No personal workday:** Employee disabled; main stays in Administration as it
  already does; floating stays in admin.
- **Non-admin:** no switch; mascot remains ordinary Employee Otto.
- **Switch refused:** popover shows the reason; no mode or conversation changed.
- **Switch request lost:** pending expires with a bounded "did not open" message;
  the original view remains and can retry.
- **Switch during streaming:** old-surface audio/microphone and request fences
  stop; a late response cannot render in the new view.
- **New chat while admin floating is open:** server fence first, then both
  windows adopt `null`; recorded work is never reverted.
- **Reload/reopen:** main persists the workspace preference; the floating window
  adopts the next context publish and opens the matching view.
- **Multiple admin windows:** conversation id and mode converge; each window
  hydrates its own thread. Audio uses the existing single-owner lease.
- **Offline:** switching view is refused with the existing connectivity copy; no
  queued mode switch.
- **Reduced motion:** costume and header transitions render their final state;
  pending/error labels remain.

## Accessibility

- The mascot switch is a real button with an accessible name that includes the
  current view.
- The popover is a labelled menu/radio group; arrow keys move between choices,
  Enter/Space selects, Escape closes, and focus returns to the mascot.
- The selected view uses text plus a check/state mark.
- Pending is announced once through a polite status region; errors use the same
  local popover alert.
- Admin Otto's existing focus trap and Escape contract remain.
- The outfit is decorative; the text label carries the mode.
- Touch targets meet 40px at the narrow class.

## Visual QA

Render and inspect:

- floating employee header, popover closed/open, pending, admin unavailable;
- floating Administration unavailable state when the admin context failed;
- floating admin header with the switch and shared cards at 420px;
- in-app Admin Otto header with the switch at 480px and 700px;
- collapsed employee orb, collapsed admin orb, both costume directions, and
  reduced motion;
- every existing mascot pose in admin attire, full and head crop;
- conversation swap in both directions with drafts and pending previews;
- New chat in both windows;
- keyboard focus order, Escape, and outside dismiss;
- 1440/1024/720/390 checks for the in-app Admin Otto sheet;
- no horizontal overflow, clipped popover, or covered close/new-chat controls.

## Verification

- Pure tests for availability, request/result fencing, mode adoption, costume
  direction, and conversation-id sync.
- Render tests for the switch, admin floating shell, New chat, and mascot
  accessories in each pose/crop.
- Focused companion tests, then the full companion/Work OS gates required by
  `AGENTS.md`.
- Rendered screenshots and TestSprite for the companion where a reusable
  fixture exists.
- Update `design.md`, the companion changelog, and `release-queue.json` with one
  verified outcome for this feature.
- At plan time `companion:release:status` reports four pending outcomes, so this
  verified feature would be the fifth. Re-run the status after landing; if it is
  still the fifth, prepare the next patch release per
  `docs/companion-release-policy.md` (synchronized version metadata, dated
  changelog section, free Linux gate before packaging, and published-release
  verification). If another outcome landed first, queue this outcome and do not
  bump the version.
