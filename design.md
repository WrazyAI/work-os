# Work OS product design specification

This document defines the visual, interaction, content, and product-design system for Work OS. It applies to the web platform, desktop companion, onboarding, operational dashboards, employee workspaces, and future Phase 2 surfaces.

The purpose of this specification is consistency. New work should feel like an extension of one product rather than a collection of independently designed pages. Existing implementations may contain older patterns; use this document as the direction of travel when touching those areas.

### Normative status and precedence

This file is the canonical Work OS design blueprint. It covers both the installed
desktop companion and the multi-user web platform, including employee, manager,
administrator, onboarding, review, evidence, and settings surfaces.

The words **must**, **should**, and **may** are deliberate:

- **Must** is a release requirement. A change that violates it is incomplete.
- **Should** is the default. Deviate only for a documented product or accessibility reason.
- **May** describes an allowed option, not a required pattern.

When sources disagree, use this order of authority:

1. Privacy, accessibility, truthful-provenance, and destructive-action requirements.
2. This specification.
3. The latest reviewed desktop Today, Tasks, focus-composer, task-detail, and contextual-menu implementations and their visual-review states.
4. Shared product tokens and established reusable components.
5. Older desktop or web screens.

The polished desktop employee surfaces are the current visual and interaction
reference. The web employee experience must converge on the same hierarchy,
language, task behavior, and material system. Web-specific manager and
administrator workflows may be denser, but they must still look and behave like
the same product. Older web layouts are implementation history, not design
authority.

Agents and contributors must read this entire document before changing a Work OS
interface. A build or unit-test pass is not design acceptance. The rendered result
must also be exercised and visually reviewed at the states and widths defined
below.

## 1. Product character

Work OS should feel:

- Calm under operational pressure.
- Clear before it is clever.
- Purposeful rather than decorative.
- Dense enough for real work without becoming visually heavy.
- Human and supportive without becoming conversational everywhere.
- Trustworthy about what was observed, claimed, inferred, or completed.
- Familiar enough to learn quickly, but distinct enough to have its own identity.

The design reference is the simplicity and navigational clarity of products such as Asana, interpreted through Work OS's own visual language: warm off-white surfaces, dark natural ink, restrained signal green, compact typography, deliberate status color, lightweight elevation, and task-first information architecture.

Work OS is not a marketing site inside an application. It is an operating surface. Every visible element should help the user understand state, make a decision, or complete an action.

## 2. Core design principles

### 2.1 Make the current job obvious

Each page should have one primary purpose. The first screenful should answer:

1. Where am I?
2. What is happening now?
3. What needs my attention?
4. What is the next useful action?

Do not give equal visual weight to every available capability. Establish a clear primary action, secondary actions, and details-on-demand.

### 2.2 Progressive disclosure over permanent complexity

Keep common actions visible and move diagnostic, provider, audit, and advanced information behind contextual disclosure.

Examples:

- The active-day header shows `On shift`, elapsed time, and `Next update`.
- Shift and Worktivity detail are available through the ellipsis menu.
- Task rows show title, status, and one useful metadata line; deeper fields belong in task details.
- Search and essential filters are visible on Tasks; uncommon filters may live in a compact popover.

Details opened from an ellipsis or contextual control should normally appear as detached floating cards or menus. They should not expand the underlying page unless expansion is the actual content model.

### 2.3 Task-first hierarchy while on shift

Before clock-in, workday readiness and clock-in are primary. After clock-in, focus and tasks become primary. The interface must change hierarchy with the user's state rather than keep pre-shift status as a permanent hero.

The active-day hierarchy is:

1. Compact shift state.
2. Today's focus.
3. Today and carry-over task metrics.
4. Task tabs and task list.
5. Progress-update composer.
6. Shift/provider details on demand.

Before clock-in, keep Shift Pulse deliberately compact: show the countdown or
schedule phase, the scheduled window, and one truthful clock-in cue. Do not
repeat Work OS session state, task counts, review counts, or check-in timing in
that card. Its ellipsis menu exposes one `Worktivity status` action, which opens
the six provider-observation facts in a detached card. Those facts must never
expand the default Shift Pulse layout.

Task planning is available before, during, and after a scheduled shift. The
anchored composer changes intent with context: before clock-in and on the Tasks
workspace it adds a task directly to today’s agenda; during the active Today
workspace it records a progress update. Its copy must always state which action
will occur, and pre-shift planning must explicitly avoid implying attendance.

The pre-shift agenda summary keeps today and yesterday separate. Show the total
scheduled for today as the primary neutral/green count, and show tasks whose due
date was yesterday as a distinct red attention count. Do not fold all historical
carry-over into the yesterday count.

### 2.4 Keep data meanings separate

Do not visually or linguistically collapse different evidence classes:

- Explicit Work OS session state.
- Worktivity observation.
- Employee-authored progress.
- AI-proposed interpretation.
- Nifty task state.
- Output evidence.
- Review or approval state.

Use labels and placement that preserve provenance. Observation is not completion. A completion claim is not verified output. A successful request is not proof that the provider accepted the mutation.

### 2.5 Use concise language

Prefer short, direct labels:

- `Today`, not `Your daily productivity overview`.
- `Add task`, not `Create a new task item`.
- `Next update`, not `Your next scheduled progress update is due at`.
- `Other days`, not `Outstanding tasks from all prior dates`.

Avoid explanatory paragraphs when layout, labels, examples, or progressive disclosure can communicate the same idea. Do not repeat the page title in a subtitle. Do not add an eyebrow, title, subtitle, helper paragraph, and banner when two of those are sufficient.

### 2.6 Motion should explain state change

Animation is used for orientation, continuity, and acknowledgement. It is not used to make routine actions theatrical.

Good motion:

- A floating card fading and moving a few pixels from its anchor.
- A progress ring interpolating after task completion.
- A row settling into its completed state.
- A receipt replacing the classification prompt.
- A tab panel fading in without shifting the page shell.

Avoid ambient motion, looping decoration, large spring effects, overshoot, or animation that delays access to controls.

**Chat acknowledgement exception.** The assistant chat surfaces may use two
bounded, non-ambient flourishes to acknowledge real events: a one-shot WebGL
colour sweep across the composer interior on send and again when a streamed
reply settles, and a word-by-word reveal of the reply text. Neither loops, both
are removed under `prefers-reduced-motion`, and the reply text is exposed to
assistive technology in full on first render regardless of the visual reveal.
Everything else on the surface still follows the limits above.

## 3. Information hierarchy

### 3.1 Application shell

The standard desktop shell has:

- A narrow persistent rail.
- A restrained masthead.
- One centered content stage.
- Optional sticky or anchored action surfaces.

The rail is for primary destinations only. Do not add every workflow, report, or setting to primary navigation. Group secondary destinations under the closest stable area.

Recommended primary employee destinations:

- Today
- Tasks
- Review
- Insights
- Evidence
- Settings

The active destination uses a soft green surface and a narrow green edge marker. Avoid high-contrast filled navigation unless the entire product adopts that pattern.

Settings and connection state form the rail footer, but remain two quiet,
separate rows on the same rail surface. Do not turn them into stacked dark
cards inside the light navigation shell.

### 3.2 Page hierarchy

Use no more than four strong visual levels on a normal page:

1. Page title or primary outcome.
2. Section title or primary card content.
3. Task/control labels.
4. Metadata and helper text.

If everything is bold, boxed, or colored, there is no hierarchy. Most metadata should remain quiet until relevant.

### 3.3 Primary, secondary, and tertiary actions

Primary actions:

- Use signal green.
- Appear once per local decision area.
- Use a clear verb and object, such as `Add task` or `Clock in`.

Secondary actions:

- Use white or surface backgrounds with a subtle border.
- Retain the same height and alignment discipline as primary actions.

Tertiary actions:

- Use icon buttons, text buttons, or contextual menus.
- Must still have clear hover and keyboard focus states.

Destructive actions:

- Use red only at the point of destructive intent or confirmation.
- Do not make ordinary cancellation red.
- Require an explicit confirmation when the operation is difficult to recover.

## 4. Layout system

### 4.1 Desktop shell dimensions

Current companion reference values:

- Navigation rail: `208px`.
- Stage horizontal padding: approximately `30px`.
- Masthead height: approximately `82px`.
- Main content maximum width: approximately `1200px`.
- Active-day card radius: approximately `18px`.

These values are reference proportions, not reasons to hard-code every page. Preserve the same perceived density and alignment.

### 4.2 Content width

Use a centered maximum-width content column for operational pages. Full viewport width should be reserved for tables, timelines, canvases, or legitimately wide data.

Do not place ordinary forms against both viewport edges. Long reading lines reduce comprehension and make sparse pages feel unfinished.

### 4.3 Grid and alignment

Align page titles, primary cards, task lists, and bottom actions to a shared content axis. Repeated controls should share heights and baselines.

Prefer:

- CSS Grid for page and card structure.
- Flexbox for control rows and compact metadata.
- A minimum-width content column plus intrinsic action column.
- Consistent row heights for comparable records.

Avoid arbitrary absolute positioning except for anchored overlays, popovers, decorative art, or intentionally floating controls.

### 4.4 Spacing scale

Use a 4px-derived spacing system:

| Token | Value | Typical use |
|---|---:|---|
| `space-1` | 4px | icon-to-label micro spacing |
| `space-2` | 8px | compact control gaps |
| `space-3` | 12px | row padding, related fields |
| `space-4` | 16px | normal card internals |
| `space-5` | 20px | toolbar/card padding |
| `space-6` | 24px | section spacing |
| `space-8` | 32px | hero and page separation |
| `space-10` | 40px | major layout separation |
| `space-12` | 48px | rare large breathing room |

Use optical adjustment when text, icons, and circular elements require it, but do not introduce unrelated one-off spacing values without a visual reason.

### 4.5 Responsive behavior

Responsive design should preserve task clarity rather than merely shrink the desktop page.

At narrower widths:

- Collapse the rail before compressing content beyond usability.
- Stack the shift action row when necessary.
- Move hero metrics below the focus copy.
- Keep Today, Previous day, and Other days tabs reachable without clipping.
- Stack the Add task button below tabs when necessary.
- Hide low-value task metadata before hiding status or title.
- Make footer actions full width when the label would collide with its icon.
- Keep the progress composer clear of system UI and task controls.
- Constrain floating cards to the viewport with internal scrolling.

Do not reduce touch targets below 40px for primary mobile actions. Compact desktop controls may be smaller when pointer use is expected, but must remain keyboard accessible.

## 5. Typography

### 5.1 Typeface strategy

Use locally available or self-hosted typefaces only. Never introduce render-blocking third-party font requests.

Preferred application stack:

```css
font-family: Manrope, Inter, "Segoe UI Variable Text", "Segoe UI", sans-serif;
```

Use the established self-hosted font configuration on the web platform. Desktop surfaces must have resilient fallbacks because font availability may differ between installed Windows environments and web previews.

Use a monospace face only for code, identifiers, timestamps requiring tabular alignment, and diagnostic output. Do not use monospace as a general technology aesthetic.

### 5.2 Type scale

Reference scale:

| Role | Size | Weight | Guidance |
|---|---:|---:|---|
| Hero focus | 25–36px responsive | 650–750 | one dominant statement |
| Page title | 21–32px | 650–750 | short and specific |
| Card title | 16–20px | 600–700 | avoid duplicating page title |
| Task title | 11–13px | 600–700 | compact but immediately legible |
| Body | 12–14px | 400–550 | use comfortable line height |
| Control label | 10–12px | 600–700 | concise verbs |
| Metadata | 8–10px | 450–600 | quiet, never essential by color alone |
| Eyebrow | 9–10px | 700–800 | uppercase, tracked, used sparingly |

Large type is reserved for the user's primary focus or a genuine summary metric. Do not use display-sized text for routine headings.

### 5.3 Line height and measure

- Hero and display text: `1.05–1.15`.
- Titles: `1.15–1.3`.
- Body and explanations: `1.4–1.6`.
- Metadata: at least `1.3` when wrapping is allowed.

Keep body-copy measure around 55–75 characters where practical. Operational labels should usually remain on one line.

### 5.4 Weight and emphasis

Use weight before color for ordinary emphasis. Reserve bold weight for names, outcomes, current values, and decisions. Avoid bolding entire explanatory blocks.

Do not underline text unless it is a link. Use sentence case for almost all interface copy. Uppercase is limited to short eyebrows, status chips, and compact system labels.

## 6. Color system

### 6.1 Foundation tokens

Current companion reference tokens:

```css
--ink: #182018;
--muted: #626a61;
--paper: #f8f8f3;
--white: #ffffff;
--line: #d9ded5;
--signal: #a8f15b;
--signal-strong: #7cc936;
--surface: #eef1eb;
--surface-raised: #fbfcf8;
```

Use warm neutral surfaces rather than pure gray. Pure white is for raised or editable surfaces, not every container.

### 6.2 Semantic color

| Meaning | Color family | Usage |
|---|---|---|
| Primary action / current progress | green | buttons, progress, active navigation |
| Yesterday requires attention | red | previous-day pending count and ring |
| Older unfinished work | amber | Other days count and contextual notice |
| Provider observation / information | blue or cool neutral | provider-only context |
| Success / completed | muted green | completed rows, confirmation |
| Warning | amber | recoverable attention state |
| Error / destructive | red | failure, destructive confirmation |
| Neutral / unavailable | gray-green | disabled, empty, unknown |

Red must remain scarce. It loses meaning if used for general emphasis. Amber differentiates aging work from immediate carry-over. Green is not proof of verification unless the label says what was verified.

### 6.3 Contrast and non-color cues

Meet WCAG AA contrast for text and essential controls. Do not communicate state by color alone. Pair color with:

- Text labels.
- Icons.
- Shape or border changes.
- Count badges.
- Accessible names.

### 6.4 Gradients

Gradients should be subtle atmospheric reinforcement, not the main content treatment. The active focus surface may use a restrained green radial wash over a warm neutral base. Avoid saturated multicolor gradients and glossy effects.

**Chat sweep exception.** The assistant composer's one-shot sweep (§2.6, §25.11)
is a full-spectrum WebGL band rendered on an overlay canvas. It is transient
acknowledgement, never a fill, never behind text, and never used to carry
meaning; it is absent at rest and entirely removed under `prefers-reduced-motion`.
This is the only permitted saturated multicolor treatment in the product.

## 7. Surfaces, borders, radius, and elevation

### 7.1 Surface hierarchy

Use surfaces in this order:

1. App background.
2. Primary content card.
3. Internal grouped surface.
4. Floating menu/dialog.
5. Focus or destructive confirmation layer.

Do not nest bordered cards repeatedly. Prefer spacing, separators, or one tinted group surface inside a primary card.

### 7.2 Borders

Use 1px warm neutral borders. Borders organize structure; they should not dominate it. Use separators for repeated task rows rather than putting every row in its own card.

### 7.3 Radius

Reference radius scale:

- Small controls/chips: 7–9px.
- Buttons and inputs: 9–11px.
- Internal notices: 10–12px.
- Cards: 14–18px.
- Pills/counts: fully rounded.
- Circular metrics/avatars: 50%.

Use radius consistently by component role. Avoid mixing sharp, lightly rounded, and extremely rounded controls in the same action row.

### 7.4 Shadows

Standard card shadow:

```css
box-shadow:
  0 1px 2px rgba(20, 30, 18, 0.035),
  0 7px 24px rgba(20, 30, 18, 0.035);
```

Floating surfaces may use a stronger but soft shadow. Shadows must indicate elevation, not decorate flat content. Do not use heavy black shadows or large neon glows.

## 8. Icons and custom assets

### 8.1 Icon system

Use Lucide icons unless an established product-specific icon exists. Standard sizes:

- 14–16px inside compact controls.
- 17–18px in navigation and section labels.
- 20–24px for empty states or standalone status.

Rules:

- Use one icon style throughout a control row.
- Do not mix emoji with interface icons.
- Icons supplement labels; they do not replace unfamiliar actions.
- Icon-only buttons require an accessible name and tooltip where useful.
- Set icons to `flex: 0 0 auto` inside label controls to prevent collision.
- Use explicit `gap` and alignment on every icon-and-label button.

### 8.2 Custom assets

Custom artwork should reinforce the Work OS identity through abstract work, organization, progress, and companion motifs. Assets should:

- Use transparent backgrounds where appropriate.
- Match the warm neutral and signal-green palette.
- Remain secondary to actual work content.
- Avoid generic stock illustration aesthetics.
- Be exported at sufficient resolution for high-density displays.
- Include intentional crop behavior at desktop and compact widths.

Do not generate a new asset when an existing mark, illustration, or icon system can serve the purpose.

The persistent floating companion may use a compact instrument treatment to
differentiate it from ordinary application chrome: a dark rounded face, a
signal-green progress ring, a large Otto silhouette, and a short plain-language
state label. The collapsed surface must read as one status object rather than a
miniature application window. Its expanded composer remains a warm, accessible
Work OS surface with standard controls and no decorative texture.

The expanded companion is one nav bar plus one scroll region. The nav bar's first
row shows the Otto mark, the name, a state dot, the shift state and elapsed time
(`On shift · 2h 14m`), and icon-only actions (New conversation, Minimize to orb,
Hide companion) each with a title and an accessible name; no visible drag label
is rendered even though the row stays draggable, and the full date lives in the
shift label's tooltip instead of a second line. The dot is green while on shift,
amber while paused, red for a late start, and gray off shift — a due check-in
never turns it red, because the banner, the orb pulse, and the composer already
carry that. The second nav row is the Chat / Tasks toggle with the open-task
count. Below the nav bar the thread is the only scrolling region: the check-in
banner, the task-context card, and every message live inside it, so the header
and the composer can never be pushed out of the window no matter how much content
accumulates. The expanded window is 400x620 logical pixels, clamped to the
monitor. The companion
is draggable from its compact grab handle and expanded header, with a visible
keyboard-operable composer once opened. A prompt bubble may overlap the upper
portion of the collapsed object, but must preserve Otto's state label, progress
ring, and the remaining-time pill.

**Otto** is the reusable visual identity for that console
(`desktop/work-os-companion/src/Otto.tsx`, `otto.css`): a compact focus robot
with one rounded ovoid body, a single signal-green visor, a lamp antenna, two
hover hands, and a pose per real workday state.

- **Silhouette rules.** Readable at 16px. One rounded body, one large visor,
  antenna, hover hands; no boxy panels or screen grilles. The visor is the only
  glowing element.
- **Palette.** Exactly three colors: ink `#182018`, paper `#f7f8f2`, signal
  `#a8f15b`. Failed states may add the danger red for a single concern mark.
  One deliberate exception exists: the **late-start tone** (`tone="late"`, see
  below), where the signal accents render danger red.
- **Pose matrix.**

| Pose | Visor | Used when |
|---|---|---|
| `idle` | steady dot, blinks | Connect screen and neutral presence |
| `sleep` | closed curve, dim antenna | Off shift / workday closed |
| `focus` | bright dot with ring | Active shift, EOD review header |
| `alert` | pulsing ring | Attention due / unfinished work |
| `rest` | crescent | Paused shift |
| `think` | three cycling dots | Interpreting or refining in flight |
| `celebrate` | wink + sparkles | Task completed, plan confirmed, EOD submitted |
| `recover` | downcast line, tilted body | Failed save, offline, degraded provider |

- **Late-start tone.** A session that begins 30+ minutes after its scheduled
  start carries a `late` tone on top of its pose: `--otto-signal` renders the
  danger red `#d4493f` (brightened to `#e2604f` inside the dark floating orb),
  and a small red clock mark appears beside the shell. The pose itself does not
  change, so the shift state stays readable; the ink, paper, and visor colors
  are untouched. The avatar status label reads “Late start — add a reason” and
  the companion ring/dot use the red `late` variant. The tone clears the moment
  a late-start reason is recorded — from the clock-in confirmation, the focus
  editor’s reason field, or the dashboard reminder. The tone never blocks work:
  it is a quiet, persistent prompt, not a modal, and it never carries
  accusatory copy.
- **Behavior.** Otto guides, reassures, and celebrates — never guilt-trips,
  never competes with primary work, never replaces a status label, and never
  becomes a dashboard card. It appears as a small quiet cue beside the Today,
  Tasks, EOD, and avatar contexts, with one large appearance on the connect
  screen. It celebrates only after work is actually recorded.
- **Motion.** Breathing, blink, and antenna glow are slow (1.6–6s) and subtle;
  celebrate is a short two-beat hop. All Otto motion is removed under
  `prefers-reduced-motion`, leaving the pose silhouette intact.

## 9. Navigation and tabs

### 9.1 Primary navigation

Primary navigation labels should be stable nouns. Changing user state should alter page content, not rename the destination unpredictably.

### 9.2 Tabs

Tabs switch between peer datasets or views in the same context. They do not perform mutations.

Task-day tabs:

- `Today`: all tasks surfaced for the current workday.
- `Previous day`: incomplete tasks attributed to yesterday.
- `Other days`: incomplete tasks attributed before yesterday.

Count semantics:

- Today uses neutral/green count styling.
- Previous day uses red only when pending tasks exist.
- Other days uses amber.

Hero metrics are intentionally limited to Today and Previous day. Older work remains available in the tab system without adding another hero metric.

Tabs require:

- `role="tablist"` and `role="tab"` where custom tab behavior is used.
- `aria-selected`.
- Visible focus.
- A selected state that does not rely only on text color.
- Responsive behavior that avoids clipped labels.

## 10. Cards, lists, and tables

### 10.1 Cards

Use a card when content forms a meaningful unit with its own actions or state. Do not use cards simply to fill empty space.

A card should normally contain:

- One header or primary statement.
- One content region.
- One action area when needed.

### 10.2 Task lists

Task lists are structured rows, not a stack of large cards. A task row should prioritize:

1. Completion control.
2. Task title.
3. One metadata line.
4. Status.
5. Disclosure affordance.

Completed tasks use subdued text and a clear completed control. Do not make them disappear immediately unless the active filter explicitly excludes completed work.

Long titles truncate in dense lists but remain available in task details or accessible text. Metadata should collapse gracefully on narrow screens.

Task lists state their order. A functional sort row may sit above a list (see 27.3). It is a `toolbar` of sort buttons, not a table header: card rows do not map onto those columns, so claiming `columnheader`/`aria-sort` semantics would misannounce every row. Each button carries `aria-pressed`, names the order it applies next, and the active order is stated in visible text, so no list is ever sorted silently.

### 10.3 Tables

Use tables for comparison across repeated columns, not for arbitrary alignment. Tables require:

- Clear headers.
- Stable column meaning.
- Horizontal scrolling at narrow widths rather than illegible compression.
- Useful empty states.
- Row actions that remain discoverable by keyboard.
- Sortable columns when a stable order helps comparison; sortable headers are buttons inside `columnheader` cells and cycle ascending → descending → the default order.

## 11. Controls and forms

### 11.1 Buttons

Every button must use an explicit layout when it contains multiple children:

```css
display: inline-flex;
align-items: center;
justify-content: center;
gap: 6px;
white-space: nowrap;
```

Do not rely on browser inline-flow spacing between an SVG and label.

Button labels should describe the result. Avoid `Submit` when `Create task`, `Save changes`, or `Send update` is available.

### 11.2 Inputs

Inputs need:

- A persistent label for non-trivial fields.
- Placeholder text only as an example, never as the sole label.
- Visible focus.
- Inline validation near the field.
- Disabled and read-only states that remain legible.
- Sensible maximum lengths matching server validation.

### 11.3 Search and filters

Search should be immediately available on data-heavy pages such as Tasks. Filters should be compact, composable, and reversible. Date filtering supports:

- A single date.
- A date range.
- Clear reset behavior.

Always show the result state after filtering. An empty filtered result should explain that no matching records were found, not imply that the user has no tasks at all.

### 11.4 Menus and ellipsis actions

Use ellipsis menus for secondary actions, not the primary action. Menus should:

- Open near their trigger.
- Float above content without reflow.
- Keep labels concise.
- Close on outside click and Escape.
- Maintain a clear anchor relationship.

If a menu option opens a richer view, replace the menu with a floating card in approximately the same location. A Back control returns to the menu.

## 12. Dialogs, popovers, and detached cards

Use a modal dialog for focused creation, destructive confirmation, or an operation that should temporarily suspend the underlying workflow.

Use a detached floating card for contextual details that should not suspend the page, such as Workday status or Worktivity details.

Requirements:

- Correct `role`, accessible name, and modal semantics when applicable.
- Close control in a predictable corner.
- Escape/click-away behavior appropriate to the surface.
- Focus management.
- Viewport collision handling.
- No underlying layout shift.
- Clear Back behavior for nested contextual flows.

Do not embed a menu's detail panel into the page below the trigger. That makes a secondary disclosure compete with primary content and changes the user's scroll position.

## 13. Status, badges, metrics, and notices

### 13.1 Metrics

Metrics should answer a specific operational question. A circular metric may be used for bounded progress or a compact count, but not every number needs a ring.

Current hero metrics:

- `X of Y tasks done`: green progress ring; clicking selects Today.
- `Z pending tasks from yesterday`: neutral at zero, red when positive; clicking selects Previous day.
- `N overdue tasks`: strict due-dated open work before today (see 27.3), never a bucket of undated older work; red, and clicking opens `Unfinished`.

### 13.2 Badges

Badges are compact metadata. They should not become primary actions. Keep count badges small and use semantic color consistently.

### 13.3 Notices

Notices should be short, local, and actionable. Use:

- Neutral for information.
- Amber for recoverable attention.
- Red for errors or urgent unresolved state.
- Green for confirmed success.

Avoid permanent banners containing implementation explanations. Move provider diagnostics, long caveats, or audit detail behind disclosure unless they block the user.

## 14. Motion and transitions

### 14.1 Timing

Reference durations:

- Hover/focus color: 120–180ms.
- Button/row state: 150–220ms.
- Popover enter/exit: 160–240ms.
- Progress interpolation: 300–420ms.
- Page-level transition: 180–260ms.
- Chat reply word reveal: ~32ms per token (capped, or instant under reduced motion).
- Chat composer sweep: ~620ms traversal plus ~90ms outro, one-shot per event.

Reference easing:

```css
cubic-bezier(0.2, 0.8, 0.2, 1)
```

### 14.2 Transform limits

Use small transforms:

- Hover lift: 1px.
- Entry translation: 4–9px.
- Press scale: approximately `0.985`.

Do not animate large layout distances for normal productivity actions.

### 14.3 Reduced motion

Respect `prefers-reduced-motion`. Remove non-essential transforms and reduce transition duration to near zero while preserving state visibility.

## 15. Loading, empty, success, and error states

Every asynchronous surface must define:

- Initial loading.
- Slow loading.
- Empty result.
- Partial/degraded data.
- Success acknowledgement.
- Recoverable failure.
- Blocking failure.

Provider-sourced calendar dates, timestamps, and timezones must be validated before formatting or date arithmetic. Invalid values degrade to unavailable copy or an empty comparison key; they must never throw during render and replace the workspace with an application error.

Loading should preserve approximate layout to reduce shift. Use skeletons for repeatable content and concise status text for one-off operations.

Empty states should be specific:

- `Nothing left behind` for a cleared Previous day.
- `No older work pending` for Other days.
- `No tasks match these filters` for filtered search.

Errors should state what failed and what the user can do. Do not expose raw credentials, provider payloads, or stack traces.

Success should confirm the persisted outcome. Avoid claiming `Task created` until Nifty or the authoritative provider confirms it. If queued offline, say so.

## 16. Copy and content design

### 16.1 Voice

Use direct, calm, human language. Avoid corporate phrasing, motivational filler, surveillance language, and exaggerated AI claims.

Preferred:

- `Recorded this as progress for today.`
- `Added this to today's tasks.`
- `Nifty sync is delayed.`

Avoid:

- `Unlock your maximum productivity potential.`
- `Our AI intelligently understood your intent.`
- `Employee activity score` when the data is only observation.

### 16.2 Labels

- Use sentence case.
- Start actions with verbs.
- Keep tab labels as stable nouns or date scopes.
- Use consistent terms: `task`, `subtask`, `progress update`, `focus`, `shift`, `Worktivity observation`.
- Do not alternate between `check-in`, `update`, and `status` for the same concept without a domain reason.

### 16.3 Explanations

Explain irreversible consequences, privacy boundaries, unusual provider behavior, and AI review requirements. Do not explain ordinary controls the user can already understand from their label and placement.

## 17. Accessibility

Accessibility is part of the component contract.

Required:

- Semantic elements before ARIA reconstruction.
- Keyboard access to every action.
- Visible focus indicators.
- Logical focus order.
- Accessible names for icon-only controls.
- Dialog focus trapping and restoration.
- Tab semantics for custom tabs.
- Status announcements for meaningful asynchronous results.
- Minimum AA contrast.
- Non-color state cues.
- Reduced-motion support.
- Text zoom and narrow-width resilience.
- No essential information exposed only on hover.

Target controls should generally be at least 40px on touch layouts. Ensure error messages are associated with their fields.

## 18. Privacy, trust, and AI interaction

### 18.1 Privacy presentation

Privacy information should be understandable and available without turning every page into a policy document. Show the immediate meaning; link or disclose the detail.

### 18.2 AI proposals

AI-derived structure must remain reviewable. Distinguish:

- User-authored content.
- Suggested content.
- Accepted suggestion.
- Persisted provider state.

Do not silently convert ambiguous progress text into a task. Ask the user to classify the update or explicitly confirm the proposed action.

### 18.3 Observation language

Use neutral observation terms. Never imply quality, intent, productivity, or completion from presence/activity telemetry alone.

### 18.4 Recalled memory context

When Work Memory feeds an agent prompt (updates, check-ins, EOD drafting and refinement, plan interpret and refine, insights synthesis), recalled history and profile facts are context only: they are dated, labeled as history, and never selectable facts, never completion evidence, and never a productivity judgment. The live day state is presented separately as current fact. Recalled context can influence emphasis but never adds prose, figures, or evidence to the output. A dev-only prompt probe (inactive in production) exposes the assembled context for automated verification.

**Insights synthesis contract (validated prose).** The insights narrative is the one
surface where the model writes its own sentences. It is accepted only when every
figure it writes appears in the exact stored record (the deterministic brief,
totals, update mix, rhythm, earlier-period totals, and daily record). Prose is
rejected — and the deterministic exact-ID rendering shown instead — when a number
is not grounded, when a decimal number appears (durations are always hours and
minutes), when a section is missing, or when a section exceeds its short-paragraph
length bound. The displayed result always records which mode was used so the
reader knows whether they are reading validated prose or the exact fact record.

## 19. Page-specific guidance

### 19.1 Today

Off shift:

- Make clock-in the primary action.
- Show schedule context concisely.
- Keep observational provider context secondary.

On shift:

- Promote focus and tasks.
- Use compact shift state.
- Keep two hero metrics only.
- Provide Today, Previous day, and Other days tabs.
- Keep progress composition anchored near the bottom.
- Keep a labeled `Focus` action in the anchored composer and beside the hero focus. Both open the same contextual editor so the daily focus can be updated without leaving Today.
- Show focus save state truthfully (`Saving`, `Saved`, `Queued offline`, or conflict recovery) and preserve whether the text was employee-authored or accepted from a task suggestion.
- Put detailed shift/provider telemetry behind ellipsis disclosure.

### 19.2 Tasks

- Search and date controls are first-class.
- On the current-day view, use one slim agenda strip beneath the page title: the focus statement on one line (activating it opens the shared focus editor) plus count chips that double as view shortcuts, and a `Review unfinished work` link only when unfinished work exists. Do not stack a large hero above the task list.
- Do not keep an editable focus textarea permanently open at the top of Tasks. Focus editing belongs in the shared anchored composer so the strip remains a summary and decision surface.
- Use exactly four views: `My day`, `Unfinished`, `Completed`, `All tasks`. There is no separate Overdue view; overdue work is the red-led first group inside `Unfinished`. Tab counts are live, and the task-list panel header always repeats the active tab label using the same word.
- At compact widths the agenda strip chips wrap; the strip stays a single surface. Historical dates use a single read-only agenda summary rather than presenting current-day actions.
- Keep filters understandable and reversible.
- Preserve the same task behavior as Today.
- Keep task lifecycle actions consistent between Today and Tasks. Viewing and completion remain direct; editing, archiving, and permanent deletion live in the task’s contextual menu, with explicit confirmation for destructive actions.
- Use a focused task-detail modal for deeper editing and subtasks.
- Clearly distinguish historical read-only views.
- Make Nifty sync state visible but not dominant.

### 19.3 Review

- Center the proposed change and source statement.
- Make Approve and Reject unambiguous.
- Preserve original employee wording.
- Show the target provider action before approval.

### 19.4 Insights

- Lead with a concise evidence-based summary.
- Use charts only when comparison or trend benefits from visualization.
- Label source freshness.
- Separate outcomes from activity observation.
- Do not manufacture composite productivity scores.

### 19.5 Evidence

- Prioritize provenance, timestamp, and source.
- Visually distinguish output evidence from activity context.
- Make the evidence record inspectable without overstating what it proves.

### 19.6 Settings

- Group settings by user intent.
- Use plain-language consequences.
- Keep destructive account/reset actions separated from routine preferences.
- Show current value or status, not only the control.

### 19.7 Onboarding

- Use one decision cluster per step.
- Preserve progress and drafts.
- Explain consent and telemetry accurately.
- Keep keyboard interaction complete.
- Do not reset later typing when an earlier draft request completes.
- Treat provider connection success and consent as separate concepts.

### 19.8 Update delivery

The companion is a long-lived tray app, so update discovery, download, and
install are one explicit, resumable flow rather than a launch-time surprise.

- **Discovery cadence.** In-app checks run on launch and then every twenty
  minutes while a signed-in session is live and automatic checks are on.
  Periodic checks are silent unless a build is available; the persistent
  flyout is the only surface they raise. A check never interrupts or
  re-pings a version already surfaced, downloading, downloaded, or
  installing; a newer version replaces a pending older one.
- **Flyout states.** Available: "Update N is ready" with a `Download update`
  action. Downloading: a **locked** card (no dismiss) showing
  "Downloading N… X MB of Y MB" and a progress bar (`role="progressbar"` with
  `aria-valuetext` in megabytes; bar hidden when the server omits a total,
  with the received-bytes text carrying the state). Downloaded: "Update N is
  downloaded" with `Update now` (primary) and `Later` (quiet); the card's
  close control is equivalent to Later. Failed: the error tone (red tint)
  with the reason plus "Check your connection and try again" and a `Retry`
  action; the card is dismissible again.
- **Progress updates replace in place.** Progress repaints reuse the flyout's
  persistent key so the card never stacks or flickers; repaints throttle to
  integer-percent steps (or 256 KB steps when the total is unknown).
- **Deferral.** Later/dismiss keeps the downloaded artifact for the session;
  Settings shows the downloaded version with an `Install` action. Deferral
  does not survive an app restart — the next session re-checks and re-offers.
- **Settings parity.** The Desktop updates row always reflects the same flow
  state (checking, available, downloading with live bytes, downloaded, failed,
  installing) and offers the matching single action: Check, Download, Retry,
  or Install. The automatic-checks toggle states the real cadence.
- **Install safety.** The exit watchdog is armed only at the install step and
  disarmed if it rejects. Its grace is deliberately long (120s) so antivirus
  holds on the installer spawn — observed past 50s — never kill the app
  mid-install; the NSIS hooks already tolerate a lingering executable. An
  install failure raises a persistent error card with `Retry` (primary) and
  `Later` (quiet): the downloaded artifact is kept, so retrying resumes, and
  the card names the manual setup path.
- **Copy convention.** Release labels render the two-digit patch display form
  (0.3.3 shows as 0.3.03); canonical versions stay unpadded wherever tools
  compare them.
- **Post-install announcement.** The first launch running a build this device
  has not announced yet raises one success flyout naming the installed
  version, with `View changelog` (primary) and `Dismiss` (quiet); either
  choice marks the version seen and it never reappears. The announcement keeps
  the success tone (green, mirroring the persistent error rule) rather than the
  default pinned-amber. The changelog action opens a read-only modal rendering that version's `CHANGELOG.md` section
  (bundled with the build, so it works offline), with a deliberate fallback
  when the build shipped without notes. The same modal is always reachable
  from a `What's new` action in Settings. Every release ships its section:
  the release workflow fails when the released version has no changelog
  entry, and the GitHub release notes carry the same section.

Notification cards support these states through optional `actions` (primary
and quiet variants), `progress`, and `locked` fields; the single-action
`action` shape remains valid for every other notification.

## 20. Implementation guidance

### 20.1 Tokens first

Use shared CSS variables or theme tokens for color, spacing, radius, shadow, and motion. Do not reproduce raw values across unrelated components when a token exists.

The assistant chat surfaces are the one place that uses **Tailwind v4** to express
these tokens. It is wired scoped and preflight-free (`@tailwindcss/vite`, no
`preflight.css`, `@source` limited to `desktop/work-os-companion/src/chat`), and
its `@theme` block maps the foundation tokens — `ink`, `muted`, `canvas`,
`surface`, `field`, `inset`, `hover`, `line`, `signal`, `signal-strong`,
`green`, `danger` — plus `radius-card/control/chip` and
`shadow-hairline/card/raised/btn`. The companion's older stylesheets are
unlayered, so they resolve above Tailwind's cascade layers; a small, explicitly
scoped unlayered bridge in `chat.css` lets the chat surfaces win where they
must. Do not extend Tailwind beyond the chat surfaces without the same scoping.

### 20.2 Reusable patterns

Before creating a component, check for an existing:

- Page shell.
- Masthead.
- Button variant.
- Empty state.
- Task row.
- Modal.
- Floating menu/card.
- Status badge.
- Search/filter control.
- Metric.

Reuse behavior and accessibility, not only appearance.

### 20.3 State ownership

UI state should map to explicit product state. Avoid multiple booleans that can create impossible combinations. Use discriminated unions or a single view state for mutually exclusive popover/menu/detail states.

### 20.4 Animation implementation

Animate opacity and transform where possible. Avoid animating expensive layout properties across large regions. Ensure the final layout exists without animation.

### 20.5 Render stability

Reserve space for asynchronous counts and status. Do not let a provider refresh move primary actions. Popovers should be layered, not inserted into card flow.

## 21. Anti-patterns

Do not introduce:

- Multiple competing hero cards.
- Permanent walls of explanatory copy.
- Embedded diagnostic panels that expand primary workflows.
- Generic dashboard grids where a task list is the real product.
- Card-within-card-within-card nesting.
- Excessive pills and badges.
- Red for ordinary emphasis.
- Icons touching labels or shrinking into text.
- Icon-only actions with no accessible name.
- Dropdowns when a short contextual follow-up is clearer.
- Silent AI inference that causes provider mutations.
- Hidden task state changes with no receipt.
- Provider observation represented as employee output.
- Decorative charts with no decision value.
- Third-party render-blocking fonts or assets.
- Large motion, bouncing controls, or endless animation.
- Desktop layouts merely scaled down until unreadable.
- New bespoke patterns when an established Work OS pattern exists.

## 22. Design review checklist

Before considering a UI change complete, verify:

### Purpose and hierarchy

- [ ] The page's primary purpose is obvious in the first screenful.
- [ ] There is one dominant action per decision area.
- [ ] Secondary detail does not compete with primary work.
- [ ] Headers are concise and not repeated.

### Layout

- [ ] Shared content axes align.
- [ ] Spacing follows the scale.
- [ ] Repeated controls share height and baseline.
- [ ] Empty and dense states both look intentional.
- [ ] No contextual disclosure causes unintended page reflow.

### Typography

- [ ] The type hierarchy uses no more levels than necessary.
- [ ] Body text remains readable at compact widths.
- [ ] Metadata is quiet but accessible.
- [ ] Fonts are self-hosted or resilient local fallbacks.

### Color and semantics

- [ ] Semantic colors retain one meaning.
- [ ] Red is reserved for urgent/error/destructive state.
- [ ] State is not communicated by color alone.
- [ ] Contrast meets accessibility requirements.

### Controls and interaction

- [ ] Icon-and-label controls use explicit flex layout and gap.
- [ ] All actions have hover, focus, pressed, disabled, loading, and error states as applicable.
- [ ] Menus and floating cards anchor correctly and close predictably.
- [ ] Keyboard behavior matches the component type.
- [ ] Mutations provide a truthful receipt.

### Responsive behavior

- [ ] Desktop, compact desktop, tablet, and narrow layouts are checked.
- [ ] No labels or icons overlap.
- [ ] Tabs remain reachable.
- [ ] Floating content stays within the viewport.
- [ ] Sticky controls do not cover page actions or content.

### Trust and data

- [ ] Observation, claim, inference, provider state, and verified outcome remain distinct.
- [ ] Freshness and degraded provider state are represented accurately.
- [ ] AI suggestions are labeled and reviewable.
- [ ] Offline or queued state is not presented as provider-confirmed success.

### Quality

- [ ] Meaningful transitions are smooth and restrained.
- [ ] Reduced motion is supported.
- [ ] Loading, empty, success, degraded, and error states exist.
- [ ] Custom assets are sharp and intentionally placed.
- [ ] Browser screenshots were reviewed at representative widths.
- [ ] Functional interaction was tested, not inferred from a static render.

## 23. Canonical cross-platform composition

### 23.1 One system, two delivery surfaces

Desktop and web share the same product model:

- The same destination names and task vocabulary.
- The same warm neutral foundation and signal-green emphasis.
- The same task-first state hierarchy.
- The same task lifecycle actions and confirmation rules.
- The same separation between Work OS session state, Worktivity observation,
  Nifty provider state, employee claims, AI proposals, and output evidence.
- The same loading, empty, degraded, success, and error language.

Platform differences are limited to delivery constraints:

| Concern | Desktop companion | Web platform |
|---|---|---|
| Shell | Persistent application rail and masthead | Product shell navigation with the same content axis and destination order |
| Density | Pointer-first compact controls | Pointer and touch-aware; slightly larger controls where needed |
| Composer | Sticky dock above the window edge | Sticky dock or page-local sticky action surface that never covers navigation |
| Overlays | Constrained to the Tauri window | Constrained to the browser viewport and safe areas |
| Provider state | May include local queue/offline state | Must distinguish browser request state from provider confirmation |
| Admin workflows | Rare and secondary | May use denser master-detail and table layouts |

Do not create a visually separate “web design system.” Tailwind utilities, CSS
modules, or component-library primitives are implementation choices; their output
must resolve to the same semantic tokens and component contracts.

### 23.2 Content axes and shell geometry

At full desktop width (`>1120px`), the reference shell is:

```text
┌──────── 208px rail ────────┬──────────── stage ──────────────┐
│ 24px top / 16px sides      │ 30px horizontal stage padding  │
│ wordmark                   │ 82px masthead                  │
│ 40px gap                   │ ─────────────────────────────  │
│ primary navigation         │ centered content ≤ 1200px     │
│                            │                                │
│ settings                   │                                │
│ connection/session state  │ 56px minimum bottom breathing │
└────────────────────────────┴────────────────────────────────┘
```

Mandatory alignment rules:

- Masthead, notices, page introductions, heroes, panels, task lists, and sticky
  composer share the centered stage axis.
- The masthead is context, not a second hero. Use a 9px date/context line and a
  21px destination title in the desktop companion reference.
- The content stage is `min(100%, 1200px)`. Ordinary pages must not become
  edge-to-edge dashboards on large displays.
- The default stage background is a warm gray-green, optionally with one faint
  signal-green radial wash near the upper-right. Content remains legible when the
  wash is removed.
- The rail is one continuous light surface. Settings and connection/session state
  are quiet footer rows separated by rules, never dark inset cards.

The installed companion uses a permanent `68px` icon rail so task space does not
shift as the window changes width; every destination retains its accessible name
and hover/focus tooltip. At `≤560px`, content uses `14px`
side padding and reserves approximately `82px` for compact navigation/system UI.
The compact shell must preserve an accessible name or tooltip for every icon-only
destination.

### 23.3 Cross-platform role variants

- **Employee:** task-first, state-responsive, supportive, and progressively
  disclosed. Today and Tasks are the primary reference surfaces.
- **Manager:** review-first. Use a master-detail composition: approximately
  `320px` queue column plus a flexible detail column at large widths, stacking at
  smaller widths. The selected employee, report date, evidence provenance, and
  decision controls must remain visible.
- **Administrator:** setup and operations-first. Use a stable tab row, grouped
  settings panels, compact health notices, and tables or structured lists for
  repeated entities. Do not reuse the employee hero merely for visual parity.
- **Onboarding:** one decision cluster per step, one primary continuation action,
  persisted draft state, and explicit separation between provider connection,
  consent, and readiness.

## 24. Canonical visual tokens

### 24.1 Foundation colors

These are the canonical light-theme values. Web tokens such as `--bg-primary`,
`--bg-card`, and `--accent` must map to these meanings rather than introduce a
second palette.

| Semantic token | Reference value | Contract |
|---|---:|---|
| `color-ink` | `#182018` | Primary text, selected dark controls, avatar |
| `color-muted` | `#626a61` | Secondary copy and metadata |
| `color-canvas` | `#eef1eb` | Outer application background |
| `color-stage` | `#f3f5f1` | Main stage background |
| `color-paper` | `#f8f8f3` | Warm base surface |
| `color-raised` | `#fbfcf8` | Primary cards and raised groups |
| `color-white` | `#ffffff` | Editable and floating surfaces |
| `color-line` | `#d9ded5` | Default borders and separators |
| `color-signal` | `#a8f15b` | Primary actions and bounded progress |
| `color-signal-strong` | `#7cc936` | Active meter fill and stronger green state |
| `color-nav-active` | `#e4f4d3` | Selected navigation background |
| `color-nav-marker` | `#75bb38` | Selected navigation edge marker |
| `color-danger` | `#d4493f` | Error/destructive/immediate carry-over |
| `color-danger-soft` | `#f8ded8` | Error/overdue background tint |
| `color-warning` | `#d99216` | Older unfinished work and recoverable warning |
| `color-warning-soft` | `#fff8e8` | Warning surface |
| `color-observed-ink` | `#235778` | Worktivity/provider observation |
| `color-observed-soft` | `#edf6fd` | Provider-observation surface |

Do not use `color-signal` for every positive-looking object. It means primary
action, current selection/progress, or explicitly confirmed success depending on
the accompanying label. Observation remains cool blue/neutral even when activity
is currently present.

**Status pills and row surfaces.** Task and list status renders as one compact
soft pill per row: `Open` neutral on `#edf0ea`, `Overdue` red on `#fbe7e3`,
`Done` green on `#e8f4da`, `Sync issue` amber on `#fff3d1`. Amber also carries
the quiet `sync pending` note in row metadata. Color is reserved for these
pills, due-date danger text, primary actions, bounded progress, and heroes;
rows themselves stay transparent with hairline dividers — no per-row fills and
no colored left edges anywhere.

### 24.2 Geometry, elevation, and motion tokens

| Role | Value |
|---|---:|
| Compact icon/control radius | `7–9px` |
| Standard button/input radius | `9–11px` |
| Internal notice/menu radius | `10–12px` |
| Standard card radius | `14px` |
| Primary hero/active-day radius | `18px` |
| Compact control height | `34–36px` |
| Standard input/search height | `42px` |
| Rail navigation row | `46px` |
| Sticky composer input | `58px` |
| Standard card shadow | `0 1px 2px rgba(20,30,18,.035), 0 7px 24px rgba(20,30,18,.035)` |
| Raised hero shadow | `0 16px 48px rgba(20,30,18,.07)` |
| Floating surface shadow | `0 18px 60px rgba(18,27,17,.14)` |
| Product easing | `cubic-bezier(.2,.8,.2,1)` |

Use a 1px border on cards, inputs, buttons, menus, and dialogs unless a semantic
state calls for a 2px edge accent. A shadow does not replace a boundary when the
surface must remain understandable in high contrast or reduced transparency.

### 24.3 Typography implementation

- Application stack: `Manrope, Inter, "Segoe UI Variable Text", "Segoe UI", sans-serif`.
- Web fonts must be self-hosted through the existing Next.js font configuration.
- Use negative tracking only for page/hero statements (`-0.025em` to `-0.045em`).
- Use tabular numerals for timers, timestamps, counts that change in place, and
  aligned operational metrics.
- Eyebrows are 9–10px, 700–800 weight, uppercase, and approximately `.08–.10em`
  tracking. Limit a screen region to one eyebrow level.
- Task descriptions use 11–12px and a two-line clamp in dense lists. Full text is
  available in details.

## 25. Canonical component contracts

### 25.1 Navigation rail

An expanded rail is `208px` wide with `24px 16px 20px` padding. The wordmark uses
a 30px mark in a 9px radius container. Navigation begins about 40px below it, uses
6px row gaps, and 46px rows with 11px radius. The active row has a soft-green fill
and a 4px by 24px marker at the outer rail edge.

The footer order is always Settings, then connection/session state. The status
row can show `On shift`, `Paused`, `Activity synced`, `Off shift`, `Offline`, or a
queued count, but it must not claim provider success from local request success.

### 25.2 Buttons and icon controls

- Compact icon button: 30–36px square, 7–9px radius, 14–17px Lucide icon.
- Standard labeled button: 34–40px high, 9–11px radius, 6–8px internal gap.
- Primary button: signal-green fill with ink text; hover may lighten and lift 1px.
- Secondary button: white/paper fill with neutral border.
- Tertiary button: transparent or quiet surface; preserve a visible hover target.
- Every icon-only control carries a `title` and an `aria-label` that names its
  action in plain words (New conversation, Minimize to orb, Hide companion,
  Collapse tasks); hover shows the quiet surface and the native tooltip, and
  keyboard focus shows the signal ring.
- Pressed feedback: at most `translateY(1px) scale(.985)`.
- Disabled controls remain readable, remove hover/press motion, and explain the
  blocker when it is not obvious.

### 25.3 Inputs, search, and date range

The Tasks search control is a first-class 42px surface with a search icon, 11px
input text, and a 27px clear button. Search matches task title, description,
project, and milestone, case-insensitively.

The date-range control is a peer 42px surface containing `From` and `To` fields.
Its range is inclusive at both ends. A single populated endpoint is valid and
means “on or after” or “on or before.” The UI must prevent or normalize an
inverted range, provide `Clear dates`, and show a result count when any filter is
active. At narrow widths, search and range stack; the range may scroll internally
but may not clip either endpoint.

### 25.4 Contextual menus

- Menus open 5–7px from the trigger and align to its trailing edge.
- Task menus are approximately 194px wide; simple two-option menus may be 176px.
- Menu items are at least 34–38px high and use icon, label, then optional quiet
  qualifier (`reversible`).
- Permanent deletion is separated by a rule and uses danger color.
- The menu floats above rows and never changes row height. Neighboring ellipsis
  triggers must not paint through it; temporarily hiding competing row triggers
  while a menu is open is acceptable.
- Use one open menu per region. Outside click, Escape, action selection, route
  change, and row removal close it. Restore focus to the trigger when possible.
- Collision logic must keep the full menu in the viewport; do not guess direction
  solely from “last row” because filtered sections may contain one item.

### 25.5 Detached detail cards

Contextual status detail uses a detached card, not an expanding row. The active
workday detail card is up to 560px wide, 14px radius, and anchored beneath the
header ellipsis. Its header has a 30px Back button, title/subtitle, and 30px Close
button. `Workday status` and `Worktivity details` are sibling options:

- Workday status: scheduled progress, start, remaining, end, elapsed, next update,
  open tasks, and awaiting review.
- Worktivity details: provider status, clocked in, clocked out, last activity,
  observed active time, provider refresh, and deducted OnBreak time.

The Worktivity surface uses the cool observation palette. It must not imply Work
OS attendance, task completion, or productivity.

### 25.6 Dialogs

Dialogs use a viewport scrim, a single raised surface, and a maximum width suited
to the operation: approximately 448px for confirmation, 512px for simple create
or edit, and larger only for task detail or evidence review. Header, scrolling
body, and footer actions are distinct regions. Destructive confirmations name the
task and distinguish reversible archive from permanent deletion.

### 25.7 Task selection card

A reusable task selection card is a fixed-height card with a static header and
footer, plus one internally scrolling row list. It is for pending or overdue
task data when a parent workflow needs explicit batch-completion intent. Rows use
native checkboxes, title, one quiet metadata line, and a text status; overdue rows
carry the danger status chip. The footer action is `Mark selected done`, disabled
until at least one item is selected, and passes only the selected IDs to its
parent callback. The card itself never mutates a task or claims Nifty
confirmation. It defines loading skeletons, a specific empty state, a recoverable
error with optional retry, a degraded last-known-data notice, and dense rows. At
narrow widths, status labels may hide, metadata wraps, and the footer action
becomes full width. Checkbox focus remains visible and all non-essential motion
is removed with reduced motion.

The header is compact and carries no kicker or count sentence: the title alone
(for example `Today's tasks`), then a `N selected` pill and the disclosure
control on the far right. The disclosure is a 26–28px icon button with
`aria-expanded`, `aria-controls`, and a `Collapse tasks` / `Expand tasks` title;
the row list — never the footer — is what it hides. Checking any item collapses
the row list into the compact confirmation state while the header and the
confirmation action stay visible; clearing the selection or pressing the
disclosure restores the list. Confirming proposals moves the card into a receipt
state, and an optional review action reveals the approval flow (`Review in Chat`
in the floating companion). Tasks that already have proposals awaiting approval
are marked `Proposed` and their checkbox is disabled, so the same task cannot be
proposed twice before the decision. Failures render inline in the card and
preserve the selection. The card still never claims that a provider mutation
succeeded.

Collapsed to a one-line summary the card states its selection (`3 selected · 1
proposed`) or, with nothing selected, the open counts (`2 pending · 1 overdue`).
Cards that lose thread focus collapse to that line automatically, so an old task
card never keeps its full list open behind newer messages.

A task with subtasks is an accordion item: its row title becomes a disclosure
button (`aria-expanded`, `aria-controls`) with a rotating chevron and an `x/y
subtasks` hint, and its panel is a labelled `role="region"` containing one row
per subtask (checkbox, title, `Open`/`Done` chip). Multiple rows may be open at
once. Subtasks are loaded with the payload when it already contains them and
fetched on first expand otherwise, with inline loading and a retryable error.
Selecting a subtask files its own completion proposal. When every open subtask
under a parent is checked, the panel offers a pre-checked `Also mark “<parent>”
done` option, and the confirm hint names the parent before anything is filed.

The in-app assistant renders this card with `presentation="table"` at wide or
compact desktop widths, adding filter chips for All, Pending, and Overdue and
Task, Due, Status, and Project columns. The header, the right-side disclosure,
the selection-compact state, the expandable rows and their subtask panel, and the
auto-collapse rule behave exactly as in the floating companion; an expanded
parent renders its subtask panel as a full-width detail row beneath the columns.
Filtering is local and never fetches or mutates. Below 560px those semantic rows
reflow to a two-line compact layout with no horizontal page overflow. The
floating companion always uses the stacked-row presentation because its 400px
window is the compact surface.

### 25.8 Assistant thinking trace

When the floating companion performs multi-step assistant work (interpreting an
update, reviewing an agenda), it may show a thinking trace instead of a bare
`Thinking…` label so the employee can see what is actually happening. The
in-app composer reuses the same trace while an interpretation is in flight,
with stages driven by its own request lifecycle (update sent, proposals
filing, task views loading).

Contract:

- Stages are driven by the real request lifecycle. Only stages that started
  render; a stage never claims work that did not happen.
- While work is in flight the trace stays open with a shimmer header and a live
  elapsed timer in tabular monospace (`2.4s`).
- Once settled it collapses to a one-line receipt (`Thought for 2.4s ·
  2 proposals to review`) that remains expandable via `aria-expanded`.
- Completed stages use a muted check; the in-flight stage uses a small spinner.
- Header uses the standard 12px semibold control type; rows use 12px semibold
  labels with quiet detail text. No Tailwind-style gallery tokens.
- All motion (shimmer, spinner, expand) is removed under
  `prefers-reduced-motion`, leaving the stage labels and receipt visible.
- The trace never replaces the approval barrier: proposals still require
  explicit review in `ApprovalFlow` before anything is recorded.

### 25.9 Approval-free assistant tools

Tools that mutate nothing bypass the approval queue entirely: the pending and
overdue task views fetch and render inline, and page-navigation shortcuts
render as inline buttons. They never create proposal rows and never show an
approval card — there is nothing to approve.

Contract:

- `display_pending_tasks` and `display_overdue_tasks` resolve through the
  read-only task-selection endpoint with the requested limit (1–100) and
  render the reusable task selection card. Failures render a short inline
  error, never an approval card and never a blank region.
- `navigate_to_page` accepts only the six primary destinations (`day`,
  `tasks`, `review`, `insights`, `evidence`, `settings`). Anything else is
  dropped before render. The button reads `Open <destination>` and moves
  immediately on click — from the avatar it focuses the main window first.
- Time-sensitive assistant news (for example a due EOD report) pairs the
  message with a navigation shortcut to the `review` destination instead of
  describing where to click.
- Mutating tools are unaffected: they still require one explicit approval
  decision per proposal before anything is recorded.

### 25.10 Task selection confirmation

Batch completion from a selection card is always two explicit loops: checking
rows only arms the footer, and a separate `Confirm Done` step files the
completion proposals. Changing the selection or the underlying list resets the
confirmation. The confirmation step names the count and states that proposals
still need approval — checking a box never marks anything done by itself.

### 25.10.1 Assistant approval flow

Mutating assistant proposals use one `ApprovalFlow` in both chat surfaces. It
shows exactly one action at a time, names the provider-facing outcome as a
question, and is strictly **read-only feedback**: the proposed statement and the
target task are shown as fixed content, never as editable fields — the card
reports what the agent will do and collects an Approve or Skip decision, and
nothing else. There is no wording editor and no task remapping control; ops are
built with the real task ids and titles taken from the same list the employee
checked (task-selection cards hand `{id, title}` pairs back, so a proposal can
never be filed with a placeholder title). An op that somehow lost its task
reference renders a flagged "no task attached" status instead of an editable
picker. Technical command details are collapsed by default. Approve and Skip
only set local decisions and advance to the next action. No provider write
happens before every action is decided; the moment the last action is decided
the whole batch is filed in one review — there is no second confirmation step,
and the per-action Back/Next navigation is the way to revisit a decision before
the last one. After filing, `ApprovalResults` reports Recorded, Queued,
Skipped, or Failed per action; a successful process exit is never substituted
for provider confirmation. Destructive actions name the target and use the
danger treatment. Keyboard focus and reduced-motion behavior follow the shared
card rules.

**Uncertain provider create recovery.** A create-task proposal whose provider
POST may have landed is not a dead end. The server records the dispatched
attempt, refuses to POST again while it is unresolved, and reports the result
as `Failed` with the review reason plus one extra action: `Nothing was created
— retry`. Choosing it confirms the provider holds no copy, clears the recorded
attempt, and files the task exactly once; an ordinary `Retry` re-searches the
provider first and adopts the task when it exists, so neither path can create a
duplicate. The action renders only while the server reports the unresolved
attempt in its payload — never from message text — and the failure copy names
both choices so the employee never has to guess which one applies.

**Shared review identity.** A review raised in either chat window is one turn
in the shared conversation, keyed by its review id, with the operations and
results attached. Both windows save conversation turns additively (merged by
turn id), so one window's save can never drop the other window's review, and
the floating companion re-adopts an open review from the shared pending-tools
record on load — a review survives reloads, restarts, and cross-window traffic
identically in both surfaces.

### 25.11 Assistant chat panel and prompt bar

The in-app dock composer and the floating companion panel share one chat
language (`desktop/work-os-companion/src/chat/*`, re-exported through
`WorkOsChat.tsx`), one interaction with contextual modes per §28 — not
lookalike input bars.

Anatomy, top to bottom:

1. **Header:** context tabs on the left, actions on the right. The dock tabs
   are `Update` (or `Agenda` in agenda mode) and `Focus`, switching the
   existing composer panel — never mutating. The companion tabs are `Chat`
   and `Tasks` (with a quiet open-task count); `Tasks` renders the reusable
   task selection card over the live task options with `loading`, specific
   empty, and degraded states, and delegates completion to the existing
   propose-selected flow. Actions are Lucide icon buttons grouped at the right:
   clear/new/close in the dock, and retry/new/minimize/close in the companion.
   The companion separates two distinct window states: **minimize** collapses
   the panel to the floating orb (the window stays on screen and is still
   draggable), while **close** hides the window entirely. Close is always
   recoverable from the tray. The two controls sit adjacent in one
   `.avatar-head-actions` group with equal 28px hit targets.
2. **Thread:** a fixed scroll region. User turns render as right-aligned
   `chat-turn-user` bubbles (max 84% width, 8×12px padding). Assistant turns
   render as `chat-turn`: a 24px **mascot** mark (never a generic sparkle — see
   the mascot rule below), then a body column, separated by an 8px gap. A meta
   line above the body is shown **only when real data exists** (a
   recorded/`review` note, or a real elapsed trace time) — labels and durations
   are never invented. Newly arrived live replies reveal word-by-word out of a
   soft blur and finish with real Copy and (when the parent can resend) Resend
   actions; the full text is exposed to assistive technology in one `aria-live`
   node on first render. Older/history turns render statically. Provenance,
   receipts, the staged approval flow, selection cards, and navigation buttons
   use the same container language in both delivery surfaces.
   **Copy:** every user bubble, assistant turn, and receipt carries a hover-and
   focus-revealed copy control in an 18px strip reserved below the bubble, so
   revealing it never shifts the thread. It copies the message prose plus a
   plain-text summary of the cards the turn rendered (task titles with state and
   due date, action lines with their status and failure detail), which keeps
   card-only turns copyable, and reports `Copied` in place for a beat. System
   notices carry no copy control.
   **Spacing:** the chat surfaces share one 4px-based scale declared as
   `--chat-space-1..6` (4/8/12/16/20/24) with `--chat-row` (40px) and
   `--chat-header` (44px) in `src/chat/chat.css`. The thread uses a 12px gap and
   16px padding (13px horizontal in the floating companion's 400px window);
   cards use a 40px header, 40px rows, a 44px footer, and 10–12px internals; the
   action-results accordion uses a 44px header and 10×12px rows. No surface adds
   its own ad-hoc spacing on top of the scale.
3. **Composer:** the shared `ChatComposer` (exported as `WorkOsPromptBar`): a
   context `+` button, an auto-growing field, an optional labeled footer action
   (the dock's `Focus` button), and a 36px square 11px-radius dark ink send on a
   raised white shell. Its interior carries an invisible-at-rest WebGL canvas
   that plays a one-shot sweep on send and on reply settle (§2.6, §6.4). Typing
   `@` filters Work OS context (today's tasks,
   focus, EOD review, evidence, day summary) and inserts an `@name`
   mention as plain text — mentioning names context, it fetches nothing.
   Typing `/` filters commands: text commands (`/progress`, `/completed`,
   `/blocker`, `/priority`, `/new-task`, `/tasks`) preface the draft so
   classification and approval still happen after send; `/focus` opens the
   focus editor and `/eod` navigates to EOD review, the explicit actions
   the user asked for. One highlight glides between menu rows; menus close
   on outside click and Escape, support arrow/Enter/Tab, and show a
   specific `No matches` state.

**Mascot.** The agent's identity and art live in one config,
`desktop/work-os-companion/src/mascot.ts` (`MASCOT`: name, description, poses,
`Mark`, assets), and chat surfaces render it through `src/chat/MascotMark.tsx`.
A global mascot change edits that config only; no surface hardcodes mascot art,
its name, or a generic sparkle where the agent is speaking. Feature icons (the
Insights synthesis sparkle, onboarding suggestions, planning badges) are not
agent identity and keep their own iconography.
`test/work-os-companion-mascot.test.mts` fails the build on drift.

Tokens and motion: the chat surfaces are built on Tailwind v4 scoped to
`src/chat` (§20.1) with the `@theme` foundation mapping; shells keep their
established borders, radius, and focus rings. Because preflight is deliberately
excluded, `chat.css` declares its layer order (`theme, base, components,
utilities`) **before** the `@import` rules — a layer statement that follows any
other at-rule is invalid and is dropped, which silently flips `base` above the
utilities and lets the reset erase every utility fill (the blank dark-button
regression). The scoped base-layer substitute strips UA button/textarea chrome
(default 1px borders, ButtonFace backgrounds) for every control inside the chat
surfaces; utilities still win over it, and legacy unlayered rules still win over
both where they target the same properties — those collisions are resolved only
by the explicit bridge at the end of the file. That bridge also re-asserts the
ink-scale text colors on chat buttons (`text-white`, `text-ink`, `text-ink-2`,
`text-ink-3`, `text-danger`), because the legacy global `button { color:
inherit }` is unlayered and would otherwise beat every layered color utility —
leaving ink-filled controls with invisible ink-colored icons and labels. The
reply reveal runs ~32ms per token and caps out (rendering instantly) for very
long replies; the sweep is ~620ms + ~90ms outro and is one-shot. Both are fully
removed under `prefers-reduced-motion`, which leaves the labels, receipt, and
full reply text visible. The two-row composer layout is derived from the draft
value (newline or labeled action), never from field measurement — placeholder
wrap changes with width, so measurement feeds back into itself and oscillates.

Delivery-surface layout differs where the page demands it. The floating panel
is a fixed-height window, so its thread, task context, and composer stay one
growing surface in flow, bottom-anchored with an auto-collapsing spacer so
short threads hug the composer instead of leaving a dead void. The in-app dock
overlays a scrolling workspace, so an in-flow flyout would extend the page's
scroll range and leave scrollable blank space beneath the content; there the
**open flyout is a detached card** that overlays above the composer shell
(`position: absolute; bottom: calc(100% + 10px)`, capped at
`calc(100dvh - 132px)` with an internal scroll), the surface hands its chrome to
the shell, and the shell carries the card chrome while open. Detaching is the
in-app dock's documented deviation from the one-surface look. The `@` and `/`
menus are detached everywhere: they portal to `document.body` with fixed
coordinates measured from the prompt bar, so no scroll container or overflow
boundary in either surface can clip them. Thread scrollers never inflate page
scroll ranges.

**The dock is anchored to the viewport bottom in every content state.** Its
sticky `bottom` pin only applies once the flow position is below the fold, so
on a short page (the off-shift dashboard) the bar used to float mid-page with
dead space beneath it. Dock views give the stage a column-flex layout with a
viewport-tall minimum and a 16px bottom padding — the exact sticky offset — and
the dock's auto top margin parks it there; the main keeps the composer's 82px
overlap through a negative bottom margin, so long pages look unchanged. The
resting and pinned positions are identical by construction.

**Reply reveal rule** (`threadScrollTarget`, shared by both surfaces): a reader
who scrolled up is never yanked; a turn that fits the thread pins to the end; a
turn **taller** than the thread (a task card) reveals its first lines at the
bottom edge so the conversation stays visible and the reply reads top-down; and
opening the dock always lands at the end. The "was at bottom" test uses the
thread height from before the arrival, so the growth of a tall reply cannot
masquerade as a scroll-up.

Companion window state lives in one place. The tray item is truthful at all
times: it reads `Hide companion` whenever the window is on screen — including
the collapsed orb — and `Show companion` only when the window is fully hidden.
Every show/hide path (the in-panel close, the orb's hover close, the tray item,
and an activated Windows toast) updates that label in the same operation, so
the tray never lies about what a click will do. Separately, a due agenda opens
the composer **once** per shift/plan state; the auto-expand is edge-triggered
and must never fight an employee's deliberate minimize.

Deliberate deviations from the exploration reference: no autoplay demo, no
dictation, no model picker, no file attachments, and no fake sources, citations,
confidence meters, brand connect chips, or follow-up suggestions — those are
unbacked controls or invented data and violate §§2.4 and 18.2. The rainbow
sweep, once rejected here, is now permitted within the bounded exception in
§§2.6/6.4. Send is 36px per §28.1, not the reference 28px.

### 25.12 Loading states

One loading language for the whole companion
(`desktop/work-os-companion/src/LoadingUi.tsx`, `loading.css`):

- **Wave** (five bars, brand green) carries every major wait: launch and the
  pre-app gate, the vault unlock, and first-day synchronization. It sits on
  the dark pre-app shell under one short truthful sentence; it never replaces
  a failure message.
- **FadeArc** (gradient spinner) carries minor inline waits: the refresh
  control, `Load older tasks`, connect-workspace while the browser opens, and
  button-level busy states.
- **Skeletons** (soft shimmer, content-shaped) reserve layout for first
  payloads: dashboard (hero, pulse, KPI strip, task cards), the Tasks list,
  task details, assignee options, and Insights. Skeletons must mirror the real
  anatomy with the same grid; they never show fabricated values.
- Waiting surfaces keep their real layout: a skeleton replaces content inside
  the established shell, so the swap does not move the page.
- **Transitions:** the pre-app shell stays dark; entering the app crossfades
  once (~300ms app fade-in over the loading surface) and skeletons hand off to
  real content without a blank frame. There is no ConnectScreen flash while the
  vault resolves — the branded loader covers boot.
- All wave, arc, and shimmer motion is removed under
  `prefers-reduced-motion`; skeletons fall back to a static fill and the
  spinner stops.

### 25.13 Client data cache

The companion keeps server state in one TanStack Query cache
(`desktop/work-os-companion/src/queryClient.ts`, `workOsQueries.ts`):

- **TTLs, not refetch-on-query.** Compact day: 60s stale time with a 60s
  background interval. Day details (history, evidence, EOD records): 2min.
  Task history: 5min. A task detail: 60s. Insights: 5min. Onboarding: 30min.
  Task options: 10min. Opening a view or reopening a task serves cached data
  instantly; it never restarts a loading state for data it already holds.
- **Lazy loading.** Day details load only when Tasks, EOD Review, or Evidence
  opens. Task history is an infinite query; `Load older tasks` fetches the next
  page and keeps prior pages cached.
- **Precise invalidation, not blanket refresh.** Task and workspace writes
  invalidate task history, task details, day details, and insights. Shift,
  report, and proposal writes invalidate the day and insights. A compact poll
  never erases loaded history, evidence, or proposals.
- **Truthful merge.** The compact payload owns fresher scalars; the details
  payload owns history/evidence/proposals. Merging preserves both, and
  in-progress local plan edits are never overwritten by a background poll.
- **Persistence.** The filtered cache persists to the Stronghold vault (24h
  ceiling, session-scoped) so relaunch paints last-known work immediately and
  revalidates in the background. Sign-out clears the cache and the vault copy.

### 25.14 Optimistic writes and save states

- **Task adds are optimistic.** The row appears immediately in the dashboard
  (task card or active-day list) and in the Tasks workspace with a compact
  spinner and `Adding to today`; the submitted payload is sent exactly once.
- **Failed adds stay in place** with a red retry control whose tooltip names the
  failure, plus a small discard control. Retry re-sends the same payload; a
  successful retry removes the pending row and the created task merges into the
  caches. Pending rows never open task details, complete, or expose the
  lifecycle menu.
- **Goal edits render immediately** and auto-save on the existing debounce. A
  spinner sits beside the focus statement while the save is in flight; a failed
  save swaps it for a red retry that re-runs the save; queued-offline keeps its
  existing notice. The same indicator appears in the hero focus line, the
  active-day focus block, and the Tasks agenda strip.
- **AI waits use the loading language:** the plan modal shows the Wave while
  building the first draft and the FadeArc while refining; EOD draft/refine
  actions use the FadeArc; task creation uses the FadeArc in its button.
  Loading indicators accompany truthful state text and never replace it.

## 26. Today page blueprint

### 26.1 Pre-shift composition

The first screenful is a stacked readiness composition at wide widths:

- **Primary hero:** readiness phrase, scheduled window, one `Clock in` action, one
  concise attendance-provenance sentence, and today's focus as a quiet editable
  line (`Today's focus`, statement, provenance, `tap to update`). The companion
  art stays small and decorative; it never displaces content.
- **Shift Pulse beside the hero:** compact countdown/schedule state. The default
  card does not repeat task counts, review counts, session state, or six
  Worktivity facts. Its ellipsis exposes `Worktivity status` in a detached card.
- **KPI strip:** four quiet stat cards in one row (`Scheduled today`, `Due from
  yesterday`, `Completed today`, `Reviews pending`). Values are large; state is
  a small delta line, red only when attention is required. Each card is a button
  that navigates to what it counts, and zero-value cards render neutral. The
  strip replaces separate agenda-summary tiles and duplicated hero metrics.
- **Today's tasks:** one panel with a `View all` link and up to three compact
  task cards: due chip, title, one-line description, and subtask progress ticks
  with a percentage. Activating a card opens the task detail. The empty state is
  a single honest line, not a decorated tile.

At `≤900px` the strip folds to two columns and the task cards stack single-column.

The agenda composer is available before clock-in. Its copy says it adds tasks or
sets focus and explicitly states that planning does not affect attendance.

### 26.2 Active or Worktivity-observed composition

The active workspace is one 18px-radius card, not several competing dashboard
cards. Its vertical anatomy is fixed:

1. **64px minimum status header:** live/paused/observed label, elapsed value,
   compact progress meter, next update, Pause/Resume where Work OS owns the
   session, Clock out where allowed, and ellipsis.
2. **178px minimum focus hero:** green-tinted neutral surface, focus eyebrow,
   25–36px focus statement, provenance, `Update focus`, and exactly two metrics.
3. **Task toolbar:** Today, Previous day, Other days, and `Add task`.
4. **Task list:** at least enough reserved height to avoid collapse while loading.
5. **54px minimum footer:** truthful Nifty sync sentence and link to full Tasks.
6. **Sticky composer:** visually attached to the workflow but layered above the
   page edge.

The two hero metrics are:

- Green bounded progress: `X of Y tasks done`, selecting Today.
- Previous-day count: neutral at zero and red when positive, selecting Previous day.

Older work uses the amber Other days tab/count and an optional local notice. Do
not add a third hero metric.

In Worktivity-observed mode, the hierarchy still transforms into the active-day
workspace. The header must identify observation truthfully and may remove Work
OS-owned Pause/Clock out actions, but the ellipsis must continue to expose both
`Workday status` and `Worktivity details`.

### 26.3 Active task row

At wide widths the row grid is approximately:

```text
26px completion | flexible title + metadata | status pill | 30px menu
```

Rows are at least 66px high with neutral hairline separators and a soft status
pill (`Open`, `Done`) aligned on the row centerline. On compact screens, hide
the redundant status pill before hiding title or completion; the layout becomes
completion, content, menu. Completion remains direct. Viewing uses the task
title/body. Editing, archive, and permanent deletion use the ellipsis menu.

## 27. Tasks workspace blueprint

### 27.1 Page order

The current-day Tasks page uses this exact order:

1. Page intro and date navigator on a shared baseline. The shell masthead owns
   the single page title and date eyebrow; this row carries only a quiet context
   label (`Today`, or `Workday history` for a past date) and the date navigator.
   Do not stack an eyebrow, a large display title, and a companion cue above the
   agenda strip, and never repeat the masthead's title here.
2. Agenda strip (see 27.2).
3. View tabs with live counts: My day, Unfinished, Completed, All tasks.
4. Search and compact filters toolbar.
5. Task-list panel with local `Add task` action.
6. Sticky agenda/focus composer, with reserved page bottom padding so it never obscures the last task or footer.

Do not restore a permanently editable focus textarea above the task list.

When a mirrored task is tombstoned (archived or deleted) — at tombstone time and
on every mirror sync — its open daily-plan items are marked `removed` so no list
surface keeps rendering them. A plan item whose task row can no longer be
resolved must never present live work: no "Awaiting Nifty sync" chip, no
clickable detail, and no completion control for a task that no longer exists.
Truthful removal, not a permanent dead row, is the required end state.

### 27.2 Agenda strip

One strip, approximately 56–72px tall, spanning the content width:

- **Focus statement:** one line (truncated with an ellipsis when long), followed by provenance and save state in small quiet text. Activating the statement opens the same focus editor as the composer's `Focus` control. It keeps a real minimum width (~280px) so controls never crowd it out of its own strip.
- **Count chips:** `My day`, `Unfinished`, `Completed`, and `All tasks` with live counts; each chip activates its view. The chips stay on one line inside their pill (they never wrap internally above 900px) and are compact enough to sit beside the focus statement at the 1200px content width. When unfinished carry-over exists, a `Review unfinished work` link sits at the strip's right edge and opens the carry-over flyout.
- Historical dates show a read-only agenda line (that day's focus, or a truthful "no focus recorded") and omit current-day mutation controls.

Between 900px and 1120px the strip reflows deliberately into two rows — the focus
statement keeps the full first row, the chips (left) and carry link (right) share
the second — so it never grows taller than the 72px budget by accident. At
`≤900px` the chips may wrap inside their own pill; the strip never becomes a
stacked two-panel hero.

### 27.3 Task views, ordering, and overdue meaning

`My day` is strictly day-scoped: it contains only tasks surfaced by today's plan,
due today, created today, or carried into today. Open tasks without a today relationship belong
in `Unfinished`, even when that leaves `My day` nearly empty — an honest near-empty
My day with a pull-from-Unfinished empty state beats a mislabeled dump of every
open task.

Tasks are grouped, not presented as an undifferentiated provider dump. Inside
`Unfinished`, and nowhere else, overdue work leads:

| Section | Membership | Order | Visual treatment |
|---|---|---|---|
| Overdue | Open task with due date before current workday | Oldest due first | Red label/count, red status pill, and red due text |
| Recent tasks | Open, not overdue | Latest meaningful task activity first | Neutral heading |
| Recently completed | Completed | Latest completion/activity first | Muted completion treatment |

**Overdue has one definition everywhere:** open work with a valid due date before
the current workday. Undated older work is unfinished carry-over, never overdue;
the amber `Other days` count states that, and no surface may compute its own
overdue predicate. The dashboard's overdue metric therefore always equals the
overdue work the `Unfinished` view shows.

**Counts describe their lists.** Every hero number, tab count, chip count, and
section count derives from the same rendered array it heads. The dashboard hero
and the Tasks workspace share one day-scoped selector, so `Today` and `My day`
can never disagree about membership or total.

**Ordering is explicit and user-sortable.** The default order is Status, then due
date: overdue (oldest due first), open work (soonest due first, undated last),
completed (latest completion first). A functional sort toolbar above the list
holds buttons for `Task`, `Status`, `Due`, `Priority`, and `Activity`; each
button carries `aria-pressed` and names the order it applies next. The `Status`
control orders the groups; every other control orders rows inside each group.
Activating a control starts at its natural direction (Activity starts latest
first), then toggles, then restores the default order on the third activation.
Each section note, and the dashboard toolbar note, names the active order, and
the choice is remembered per surface. No list renders in an unstated order.

Provider refresh timestamps must not masquerade as meaningful task activity when
a provider-created, provider-updated, completed, or user-action timestamp is
available. Tie-break deterministically by normalized task title.

The metadata shown on a row must explain the row's position: a group sorted by
activity never displays creation dates as its only timestamp, and due dates appear
wherever they drive ordering. Creation dates live in the task-detail view, not the
row.

Malformed provider titles/descriptions, HTML error bodies, `[object Object]`, and
fetch exception text never render as task content. Use `Untitled Nifty task`, `No
description added.`, `Nifty details unavailable`, or another deliberate fallback.
Invalid timestamps never reach a formatter that can throw.

### 27.4 Task row anatomy

Rows are compact, flat, and scannable; the task-detail view is the place for
depth:

- Rows are transparent surfaces separated by hairline dividers — never
  individual bordered cards. Surface tint belongs to heroes, groups, and heroes'
  content cards; a row never carries a colored fill or a colored left edge. The
  overdue group keeps its red label/count only.
- Row grid: `24px completion | flexible title + metadata | progress | due date |
  status pill | 30px menu`. The status pill is the single semantic voice:
  `Open` (neutral), `Overdue` (red-soft), `Done` (green-soft), `Sync issue`
  (amber-soft, degraded only). Completion is a direct checkbox; historical rows
  omit it.
- Title line one; metadata line two carries assignee, project, milestone, and
  priority — each only when present, plus a quiet amber `sync pending` note when
  a record is not yet mirrored. Description is hidden when empty and otherwise
  truncated to one line; full text lives in the task-detail view. Never render
  the empty placeholder on the row.
- The title line is a single row that never wraps: the title ellipsizes and the
  `On today` tag always ends the line, so the tag can never fall onto the
  metadata line and evict its content. In-row assignee chips match the metadata
  text's height (~20px), so rows with and without an assignee keep one rhythm.
- The completion checkbox and the subtask ring align with the title's first line
  while the due date, status pill, and menu stay on the row centerline.
- Tasks surfaced into today show a small `On today` tag beside the title. The
  only header row above a list is the functional sort row from 27.3 — a control
  surface with real sort buttons, not an ornamental replica of the row grid.
  Aggregate provider freshness lives once in the strip or toolbar; per-row
  provenance chips are noise.
- Completed rows keep the muted treatment, strike-through title, and the `Done`
  pill.

### 27.5 Filtering states

- Search is always visible on Tasks; the From/To date range is an uncommon
  refinement and lives in a compact popover next to search. Search and date range
  compose with the selected view; neither silently resets the other.
- Show `N results` whenever filters are active.
- The filtered-empty state is `No tasks match these filters` plus a clear-filters
  action. It must not say the user has no tasks.
- The unfiltered empty state reflects the selected view: for example, completed
  tasks will appear after completion, and a strict day-scoped My day that is
  empty offers unfinished work for review instead of pretending the day is
  loaded.
- `Load older tasks` is explicit pagination, not an ambiguous `Load more`.
- Historical task workspaces are read-only but retain search, inspectability, and
  a truthful original-day link where relevant.

## 28. Shared composer blueprint

The composer is one reusable interaction with contextual modes, not separate
lookalike input bars.

### 28.1 Dock geometry

- Sticky near the bottom (`16px` desktop, about `10px` compact).
- Width: `min(calc(100% - 48px), 760px)` at full width.
- Input shell: at least 58px high, 17px radius, white raised surface.
- Focus control: labeled 36px-high secondary button on desktop; icon with an
  accessible hidden label at very narrow widths.
- Send control: 36px square, 11px radius, dark ink when enabled.
- Reserve page bottom padding so the dock never obscures the last task or footer.

### 28.2 Modes and outcomes

| Context | Default intent | Allowed outcomes |
|---|---|---|
| Pre-shift Today | Agenda planning | New task, focus edit |
| Tasks workspace | Agenda planning | New task, focus edit |
| Active Today | Progress communication | Progress, completed work, blocker, priority change, new task |

Ambiguous active-day text opens a classification conversation. It is not silently
reduced to “progress.” Classification options remain explicit and the final
receipt names what was recorded or proposed. Focus opens the same goal editor from
the hero and dock. The goal editor shows provenance, save state, optional task
suggestion, and the statement that focus does not affect attendance.

The flyout appears directly above the dock with approximately 16px radius and a
48px header. It may scroll internally, must close on Escape, and must preserve
typed content unless the user intentionally discards it.

## 29. Supporting surface blueprints

### 29.1 Review

Review is a decision workspace, not an activity feed. Its wide composition is:

1. Page introduction and compact pending count.
2. One short control-flow strip showing `Your update → Structured draft → Your
   decision → Nifty write-back`.
3. Proposal cards ordered oldest decision-needed first unless product urgency
   explicitly overrides age.

A proposal card uses three regions:

- **Header:** sequence/index, operation type, affected task/entity, and proposal
  status.
- **Comparison:** employee wording on the left, proposed structured change on the
  right, with a directional cue between them. Stack source then proposal at narrow
  widths.
- **Footer:** truthful provider-write status on the left and `Reject` then
  signal-green `Approve change` on the right.

The original employee statement is visually quoted and never rewritten. Proposed
fields use a compact definition list rather than prose. Stale proposals lose
mutation actions and explain why they need regeneration. Approval remains a
primary local action only while the proposal is actionable; a successful browser
request is not displayed as Nifty write-back until provider confirmation exists.

### 29.1a EOD draft refinement

An EOD draft may be refined from employee feedback before it is submitted to a
manager. Feedback is a separate, local decision area beneath the editable report:
the primary action is `Refine draft`, and its helper copy states that the
employee-authored bottleneck remains separate. Selecting text in the preview
raises the floating selection annotator; saved notes collect in a `Draft notes`
tray whose quote chips flash the matching passage in the draft, and refining
sends the notes plus free-text feedback while the bottleneck answer is never
included. The AI request receives the report narrative, feedback, and bounded
annotations, never the bottleneck answer. The required bottleneck entry renders
before the optional refine area so the mandatory ask is never buried behind an
optional one. A failed refinement preserves both the report, feedback, and
bottleneck input.

The bottleneck requirement is resolved from wherever the employee actually
answered: the dedicated field first, then a real `## Bottleneck` section in the
report draft (the server's `(needs your input — …)` placeholder never counts).
A typed answer is never cleared in the background; when every task in the
current-day list becomes complete, the field is disabled but its value is
retained, and the bottleneck section is omitted from the submitted report.
Otherwise a submission without a resolved answer is blocked, and the disabled
`Submit EOD` control always names its blocker in the footer: the missing reason,
an empty report, a draft still in flight, or a running refinement.

### 29.1b Plan draft refinement

Confirming the day requires an AI-built plan draft first: the footer shows
`Close`, a disabled `Refine plan`, and `Build my plan`. `Confirm my day`
replaces `Build my plan` only once a draft exists, and stays disabled while
annotations exist, while feedback edits are unsaved, or while clarification
questions are unanswered. Each state carries one plain-language hint naming the
exact unblock action.
Draft review carries pencil (edit mode) and trash (two-tap delete, local discard
only) controls. Reading is the annotation state: highlighting text inside one
semantic block (summary, title, objective, or criteria) raises a floating
annotator anchored at the selection — the quoted excerpt, a one-line comment
field, and confirm/cancel controls. Enter or the check saves; Escape or cancel
dismisses; the popover is clamped inside the viewport and never covers the
selection it refers to. Saved annotations render as highlighted quotes with a
per-section count bubble; activating a highlight opens a review card with the
quote, the comment, and Edit/Delete, and `{N} Annotations` remains in the footer
beside a matching count on `Refine plan`. Pencil switches to document editing,
which suspends selection capture and names the mode in the hint; edits and
annotations refine together — annotations never lock the text. The editable
draft is one document-like inline canvas that preserves the review hierarchy; it
must not become a stack of visibly bordered form controls.
Refining sends the draft plus annotations and field diffs and
returns a fresh draft; annotations are single-use and clear on each new draft.
A failed refinement keeps the current draft. The only exception is an
AI-outage off-shift save, which preserves the raw planning note without a draft.

### 29.1c Outstanding EOD days

A bell control in the masthead is the persistent home for prior workdays whose
EOD was never submitted to a manager. It is an icon-only control with an
accessible name and an amber count badge while days are outstanding; the badge
is absent at zero.

Activating the bell opens a detached card (up to 380px, anchored to the
trigger's trailing edge) titled `Outstanding EODs`. Each row names the calendar
date, one metadata line (weekday, observed minutes, completed Nifty outcomes),
and exactly one status pill: `Needs draft` (amber), `Draft not submitted`
(neutral), or `Changes requested` (danger-soft). Rows open the Review workspace
for that day. Submitted, pending, and approved days never appear, and days
without a recorded session or plan are not treated as outstanding. The list
looks back 14 days and never counts today, which Review already covers.

Selecting a row loads that day's record and shows a local `Back to today`
context strip above the composer. The composer keeps its existing refine,
annotation, bottleneck, and submit contracts but receives the selected day's
label, so copy never says `today` while the report belongs to another date.
Creating a draft updates the row's status; submitting removes it. The badge
refreshes after either action.

States follow §31: skeleton rows while the list loads; `You're caught up` when
none remain; a local retry notice that keeps cached rows visible when a refresh
fails; `Back to today` returns to the live day. Observed minutes remain neutral
activity context, never productivity, and copy avoids guilt framing.

### 29.1d Confirmed SOD commitments become Work OS tasks

Confirming an AI-built day plan materializes it: every commitment that is not
already linked to a task becomes a Work OS-native task (never a provider call),
and every success criterion becomes a subtask under its commitment's task —
including commitments the draft linked to existing tasks. Task fields map
truthfully: commitment title → task title, objective → task description, and
each criterion → subtask title (trimmed to the 240-character title limit).

- **Timing.** Materialization happens only on confirm, not on draft saves or
  build. The plan item is then linked to its task (`item_kind='local_task'`), so
  re-confirms and refreshes never duplicate work: a linked item is retained, and
  creation is additionally guarded by plan-scoped content markers.
- **Repeat titles.** A commitment whose title matches an open Work OS task for
  the same employee, due within the last 7 days (normalized: trimmed,
  whitespace-collapsed, case-insensitive), continues that task instead of
  creating a second one. The plan item links to the existing task, whose due
  date is left unchanged, so the day shows it once as unfinished work and the
  receipt says `continued N existing tasks` rather than counting it as created.
  The window is deliberately narrow: same-named efforts older than a week — or
  for another person, or already completed/archived — still create a new task,
  and subtasks remain parent-scoped so identical criteria under different goals
  never merge.
- **Failure.** A failed creation is best-effort and audited; the item stays
  unlinked and retries on the next confirm. When any goal fails, the confirm
  receipt says how many could not be created instead of claiming success.
- **Preview.** The plan review shows a truthful one-line preview before confirm:
  `Confirming creates N Work OS tasks with M subtasks.` When every commitment is
  linked, it reads `Confirming adds M subtasks to your existing tasks.`
- **Provenance.** Work OS-native tasks carry a `Work OS` source label in every
  task surface (details footer, sync chip, delete/edit copy) and never claim a
  Nifty record; Nifty-mirrored tasks keep their existing Nifty labels and sync
  chip while the two sources coexist.
- **Lifecycle.** Complete, edit, archive, delete, and subtask move all write
  locally for these tasks with no provider call, and completing them never
  claims a provider confirmation. Planner tasks are due the plan's day and are
  assigned to the confirming employee.

### 29.1e Loom updates

Employees often record their SOD or EOD in Loom before opening Work OS. A Loom
link is therefore a first-class update source, not an attachment to a second
report, and it is opt-in per organization behind the `loom_updates` flag.

The composer (web update panel, desktop Update composer, and the EOD composer)
offers a `Loom` control that reveals a local panel: a link field, a `Read Loom`
action, and an optional transcript paste. `Read Loom` resolves the link through
Loom's official oEmbed endpoint and shows only the public title and duration it
returns; a private or unavailable recording reads as `metadata unavailable` and
never blocks the update. The panel states plainly that the link and transcript
become the update and an output artifact and that no video is stored.

The link must be an `https` Loom share or embed URL (or a bare 32-hex video id);
anything else is rejected before any server-side fetch, and the fetch is
allow-listed to Loom hosts with no redirects, a short timeout, and a bounded
response. Transcripts are stored with the check-in in `structured_claims.loom`,
bounded and labeled with their source (`employee_paste`); the full transcript is
never shown inline in history — the update stream shows a compact Loom chip with
the recording's title and length instead.

A Loom update is a substantive update: it feeds proposal synthesis (tasks,
subtasks, progress) and the AI EOD draft, where the recording appears as a
`Recorded Loom updates` fact with the explicit note that recordings are
employee-authored artifacts and do not by themselves prove task completion. It
also records a `loom` output-evidence event (title, link, duration, thumbnail)
idempotent per video id, which satisfies the task-completion artifact gate the
same way a linked pull request does. Attaching a Loom in the EOD composer files
the update and rebuilds the draft from it, so an employee who already recorded
their EOD never writes a second one.

### 29.2 Insights

Insights follows summary → comparison → exact record:

1. Page intro, Day / 7 days / 30 days range control, and a freshness chip row
   (Nifty synced, Worktivity observed, and a red-led chip when sync is delayed).
2. AI synthesis card: the assistant writes three short grounded paragraphs
   (highlight, attention, focus) under bold section labels. Every figure it
   writes must appear in the exact record below; decimal numbers are rejected
   and durations are always hours and minutes (`2h 48m`, `48m`). When validation
   fails the card shows the deterministic exact-fact rendering and says so. The
   hint copy states the ground rules instead of promising a fixed behaviour.
3. A four-tile metric row for separate evidence classes, never a composite score.
4. Evidence-based brief with Wins, Needs attention, and Next focus; an empty
   class renders a quiet placeholder line instead of a blank box.
5. Trend visualization when at least two comparable dates exist.
6. Work mix and update composition.
7. Consistency and rhythm.
8. Activity context, exact-values table, latest-day drilldown.
9. Source freshness and limitation note.

Use no more than four primary metric tiles in the first row. A tile is at least
126px high on wide desktop and contains one icon, label, a value, an optional
sparkline of that same class, and an optional delta chip against the equal-length
earlier period. Observed duration, planned-commitment completion, Nifty outcomes,
and output evidence use separate labels and scales. A dual-series chart must
provide a legend that names both scales; it may not visually imply that activity
time and task completion are the same measure.

Chart kit contract (desktop companion `InsightCharts.tsx` + `insight-charts.css`):

- **No chart scrolls vertically.** A chart's height is its content; it never
  nests a vertical scrollbar, never stretches to fill a taller sibling, and
  never leaves a pocket of dead space beside short data. Chart cards that share
  a row center or stretch their content deliberately (work mix centers; bar
  lists align to the top).
- **Split first, stacked only when narrow.** Chart cards use a chart-left /
  data-right split with adjacent cards alternating sides (`.insight-split` and
  `.insight-split.mirror`) so the page does not read as one repeated column.
  Below 980px every split collapses to one column in DOM order.
- **Horizontal scroll is allowed and bounded.** A chart wider than its column
  scrolls sideways with edge fades that appear only while more content remains
  in that direction; it still must not scroll vertically.
- **Workday trend.** Dark bars are observed session minutes on the left axis; a
  single green line is planned-commitment completion on a 0–100% right axis.
  The axis top is a round value (`8h`, `30m`) with gridlines aligned to five
  `0/25/50/75/100` rows, and bars scale against that top so ticks and labels
  agree. The completion line breaks at days without planned commitments and
  renders a point marker per recorded day, so it never bridges unrecorded time.
  A zero-observed day shows a quiet stub, never a floating dash. A right-hand
  summary column names the peak day, daily average, recorded-day count, and
  average completion, and the legend names both scales in words. Bar labels
  thin out by stride when the range is dense; every day is a focusable control
  whose tooltip and accessible name carry the exact date, observed duration,
  completion, outcomes, updates, and blockers. A single-day range states that a
  trend needs two recorded days instead of drawing one bar.
- **Work mix.** A donut with fixed, labeled classes — Outcomes completed,
  Progress updates, Deferred, Carried over, Unplanned — beside a compact legend
  that repeats every count and its share of the range. Hovering a slice or a
  legend row lights the pair, dims the rest, and swaps the center readout from
  the range total to that class. No class is ever merged or weighted.
- **Updates & blockers.** Rows are label-above-track: the head line carries the
  label (with `needs attention` for non-zero blockers, priority changes, and
  unplanned work) and `value · % of range`; a slim rounded track shows the same
  share. An all-zero range renders one quiet sentence instead of zeroed rows.
- **Consistency & rhythm.** A Monday-first calendar heatmap of completed
  outcomes sits beside the stat rows (goals written, updates recorded, days with
  outcomes, commitments completed, closing streak, largest day) and a stacked
  on-time vs late bar for outcomes that carried a due date. The heatmap keeps
  seven fixed weekday rows, month labels, an intensity legend, and a reserved
  hover readout; cells scale between 16px and 30px, and the strip scrolls
  sideways only. Undated work is never classified either way.
- **Activity context.** Top apps as the same label-above-track rows with
  `minutes · % of tracked` beside a per-day tracked-minutes bar chart, always
  inside the neutral-context panel with its provenance line.

Long records bound themselves. The exact-values table and the latest-day record
render inside a `ScrollFadeRegion`: a fixed max height, internal scrolling, and
frosted top/bottom edges that appear only while content remains in that
direction. Each region is a focusable `role="region"` with an accessible label,
so keyboard users can scroll the record directly.

Charts reserve their geometry while loading, include exact accessible text, and
fall back to the same values as a plain table at narrow widths. Stale data remains
visible with a local freshness notice rather than disappearing behind a spinner.

Motion is explanatory only: bars grow from their baseline once, the completion
line fades in once, cells and tiles fade in with a short stagger, and reduced
motion renders the final state instantly. No looping, bouncing, or overshoot.

Selecting a range must render that range's record or a skeleton — never the
previous range's chart and table. A record whose `range`/`through` does not
match the active selection is treated as absent; the synthesis narrative resets
with it. Refreshing revalidates the active range only.

Grounded facts may include comparison deltas (equal earlier period), outcome
timing with due dates, blocker and update-kind counts, goal/update consistency,
and closing streaks. Every sentence restates stored values; none of them becomes
a productivity score.

Activity context is an explicit evidence class: tracked app/site minutes from
Worktivity summaries may appear as a `Tracked` column, an aggregated top-app
list for the range, and a grounding line in the brief. It is always labeled as
neutral observed context, is never combined into a score, and never implies
task completion or productivity.

### 29.3 Evidence

Evidence is provenance-first. Default to a structured list or timeline with:

```text
evidence class | title and summary | source | observed/created time | status/actions
```

The title states what the record is, not what it supposedly proves. The metadata
line always includes evidence class and source. Output artifacts, employee claims,
Worktivity context, screenshots, provider events, and review decisions use
distinct labels.

Evidence details may reveal identifiers, timestamps, hashes, provider links, and
correction history behind disclosure. Raw screenshots are restricted content:
show availability and review state first, request a reason before access, audit
the access, and present the image in a modal with a neutral descriptive alt label.
Never use a screenshot thumbnail as a decorative productivity indicator.

The EOD composer's own-screenshot review panel is the employee-facing exception
to the reason prompt: the employee is reviewing their own frames, so access is
implicit and every view is still audited. Its contract is fixed:

- The collapsed section states how many frames were analyzed for the day and the
  limitation that sampled context never proves completion, effort, or quality.
- Observation rows show the frame that produced them as a 64x40 thumbnail beside
  the capture time and neutral summary. Frames without a retained image stay
  text-only; they never show a broken image or a placeholder that implies content.
- A horizontal carousel of the seven most recent retained frames ends with a
  `+N more` tile that opens the full day as a multi-column grid modal. Selecting
  any frame opens a lightbox with the full-size image, a caption naming capture
  time and app, keyboard arrow navigation, and Escape-to-close with focus
  restored to the invoking tile.
- The counts line is honest per disposition: analyzed, flagged as sensitive
  (image deleted), excluded by the employee's own exclusions, and unavailable.
  Never collapse a sensitive exclusion into "privacy policy" when it was the
  model's sensitivity filter, and never imply a deleted frame can be recovered.
- Thumbnails and previews are server-rendered from the retained encrypted frame;
  the browser never receives the stored object directly. Preview responses are
  private-cached and every fetch is written to the screenshot access log.

Dispute/correction actions are visually secondary but discoverable. A disputed
record remains in the timeline with its correction status rather than vanishing.

### 29.4 Settings

Settings is organized by user intent, in this order where applicable:

1. Profile and locale.
2. Schedule and notifications.
3. Privacy and exclusions.
4. Provider connections and sync state.
5. Application behavior.
6. Diagnostics.
7. Destructive reset/account actions.

The companion groups its rows under those headings (`This device`, `Workday`,
`Sync & session`, `Diagnostics`, and a separated `Reset` group). Each group
carries a quiet uppercase label and a one-line purpose; the reset group is
separated by a rule and a red-led label, never mixed into routine preferences.

Each setting row uses a flexible label/description column and intrinsic control
column. Rows are normally 72–104px high depending on helper copy: size to the
copy (min-height 84px) rather than padding every card to a fixed tall height,
and align the control with the title's first line. At narrow widths, stack the
control below the explanation and make it full width when appropriate.

Controls follow one vocabulary:

- **On/off preferences use the settings switch** (`role="switch"`, 34x18 track,
  tokens for the off/on colors) with the state written beside it (`On`/`Off`).
  Never ship a bare native checkbox in a settings row.
- **Statuses are chips, not controls.** A value the employee cannot press
  (`Avatar`, `Hidden`, `Ready`, `Checking`) renders as a chip — no border or
  button chrome. Amber tint belongs only to work that needs attention.
- **Actions keep the quiet-action button style**; destructive actions use the
  danger tone and confirm first — `Reset` names what is cleared, and signing out
  asks before ending the session.

Do not place unrelated settings in dashboard metric cards.

Provider connections show provider name, mapped identity/workspace, last verified
state, and a clear reconnect or inspect action. `Connected` requires a verified
provider-scoped read, not the presence of stored credentials. Destructive settings
live in a separated danger section and require explicit confirmation.

### 29.4a Work memory panel

Work memory is its own surface on the Settings page (`MemoryPanel`), and it is
never a card inside the settings card grid: it owns a single-column layout whose
sections span the full panel width. Reusing the settings grid interleaved the
sections and put headings beside one another — that is the failure mode this
contract forbids.

The panel opens with the title `What Otto remembers`, one line stating the
model (nothing is remembered until the employee keeps it, and anything can be
forgotten), and a pending badge (`N waiting for review`) only when candidates
exist. It then renders three classes in this fixed order, each as its own
`<section>` with a label, a count, and a separator:

1. **Waiting for your review.** Proposed facts waiting on a decision. The only
   bordered cards in the panel, because they carry the two actions: `Keep`
   (primary) and `Not true` (quiet). Sorted newest first; the two-up card grid
   collapses to one column at 1024px and below.
2. **Remembered facts.** Kept facts. Flat rows on hairline separators (the
   repeated-row pattern — not cards), each with a verified glyph, `Kept
   <month day>`, and a `Forget` action. Rows are full-width so long facts stay
   readable.
3. **Recent activity.** Dated episodes Otto drew on (check-in, plan, task event,
   evidence, EOD, conversation), rendered as a muted feed with a kind label per
   row, the summary, the date, and a `Forget` action. The feed shows the eight
   most recent entries with a `Show all N` control that expands in place (and
   `Show less` that restores it), so nothing returned to the panel is
   unreachable. It closes with the provenance line: context only, never proof
   that work was completed.

Every class states its own empty value rather than disappearing, and the date in
every row is a calendar day (`formatWorkOsDate`) — never a raw serialized
instant, even when the API returns a SQL date as a timestamp. `Forget` deletes
the underlying memory in both facts and activity; rejecting a candidate removes
it from review without remembering it. Below 640px the action labels collapse to
their icons, which keep accessible names.

### 29.5 Onboarding

Onboarding uses a focused single-card flow rather than the full operational shell.
Each step contains:

- A quiet progress/phase label.
- One short outcome-oriented heading.
- One decision cluster or related field group.
- Local help for privacy, schedule, or provider consequences.
- Back and one primary continuation action.

Keep the content measure narrow enough to scan; forms normally use one column and
may use two columns only for paired values such as shift start/end. Save drafts as
fields become valid and preserve later typing when earlier network responses
return. Provider connection, notification permission, Worktivity mapping,
screenshot configuration, and consent are separate checkpoints with separate
truthful states.

Consent is never a decorative checkbox. The surface names the data, purpose,
retention boundary, sensitive-capture behavior, and withdrawal route before the
acceptance control.

### 29.6 Manager review

At large widths, manager review uses a `320px minmax(0, 1fr)` master-detail grid:

- **Queue column:** pending reports with employee, report date, and decision state.
  The selected row has a non-color marker and stable surface treatment.
- **Detail column:** employee/date header, submitted report snapshot, sourced
  evidence, manager notes, and final decision footer.

The evidence area is collapsed to summaries by default and preserves employee
privacy boundaries. `Reject` is outlined danger; `Approve` is signal-green.
Neither action is icon-only. After a decision, retain a receipt and advance to the
next pending report only when doing so will not discard unsaved notes.

On compact widths, queue precedes detail and selecting a report may move focus to
the detail heading. Provide an obvious path back to the queue.

### 29.7 Administration

Administration is denser than the employee experience but uses the same tokens,
typography, controls, notices, and provenance rules.

- Use stable noun tabs for Today, Tasks, People, Schedules, Blueprints, Evidence,
  Reports, and Settings.
- Place readiness or system blockers above the affected workflow, not in a global
  wall of alerts.
- Prefer tables for repeated entities and structured forms for creation/editing.
- Use a two-column working grid only when the left context or selection directly
  controls the right content.
- Group connection fields by provider and identity; do not expose internal IDs as
  the only human label.
- Health summaries use explicit counts and source timestamps. They are not hero
  marketing metrics.
- Long forms are divided into named sections with local save actions or a single
  sticky footer, never several visually identical primary buttons in one panel.

## 30. Responsive specification matrix

Every changed surface must be reviewed at these representative classes:

| Class | Reference viewport | Required behavior |
|---|---|---|
| Wide desktop | `1440×900` or larger | 208px rail, side-by-side heroes, all useful metadata |
| Compact desktop | approximately `1024×768` | 80px icon rail, usable stage, overlays inside viewport |
| Narrow/tablet | approximately `720×900` | agenda strip chips wrap, compact rail/navigation, composer clear of rows |
| Small | approximately `390×844` | single-column content, touch targets ≥40px, no horizontal page scroll |

Specific collapse rules:

- At `≤1120px`, collapse rail labels before compressing task content.
- At `≤900px`, wrap agenda strip chips and search/filter controls onto stacked rows.
- At `≤560px`, stack the active-day header and footer actions, hide redundant task
  status labels, make task tabs share available width, and use two columns for
  detail facts.
- Long task titles and focus statements wrap where they are primary; task rows
  clamp descriptions to one line (see 27.4).
- Menus, dialogs, and detached cards use viewport collision handling and internal
  scrolling. They never extend beneath the sticky composer or browser safe area.
- The composer must not cover the row action currently being used. Scroll or
  reserve space rather than relying on transparency.

Test zoom at 200% or an equivalent narrow content width. Layout must remain
operable when system font metrics differ from the design machine.

## 31. Operational state matrix

For every asynchronous page or reusable component, implement and review the
applicable cells:

| State | Required presentation |
|---|---|
| Initial loading | Stable skeleton or reserved geometry; primary actions do not jump |
| Refreshing | Existing truthful data remains visible with local refresh affordance |
| Empty | Specific to the current view and offers the next useful action |
| Filtered empty | Says no records match and offers clear/reset |
| Dense | Long titles, many rows, counts, and metadata remain aligned |
| Partial provider data | Deliberate fallback copy and source/freshness label |
| Offline/queued | Says queued locally; never says Nifty confirmed |
| Recoverable error | Local notice, retry, and preserved user input |
| Blocking error | Clear failed boundary and recovery route; no raw stack/payload |
| Optimistic mutation | Visually pending until authoritative confirmation |
| Confirmed success | Concise receipt naming the persisted outcome |
| Conflict | Explains changed provider state and preserves both user intent and latest value |
| Read-only history | Removes mutation affordances while retaining inspection and provenance |

Date and time formatting is a rendering boundary. Validate ISO dates, instants,
timezone identifiers, durations, and range endpoints before using `Date`, `Intl`,
or arithmetic. Unavailable data renders `—`, `Unavailable`, or context-specific
copy. It never produces `Invalid Date` or an application-level error screen.

## 32. Design governance and acceptance

### 32.1 Before implementation

An agent changing UI must:

1. Read this document in full.
2. Identify the applicable page blueprint, component contracts, responsive rules,
   state matrix, and provenance constraints.
3. Inspect the latest reviewed implementation and preview state rather than copying
   an older adjacent screen.
4. Inventory reusable tokens/components before adding a new pattern.
5. State any intentional deviation and the product reason before implementation.

### 32.2 During implementation

- Reuse semantic tokens; do not scatter near-duplicate hex values or dimensions.
- Keep desktop and web behavior aligned when both expose the same workflow.
- Add or update deterministic preview fixtures for important visual states.
- Add behavioral tests for sorting, filtering, empty states, date validation,
  overlay closure/focus, and mutation receipts where applicable.
- If a new pattern is likely to recur, document its anatomy and rationale here in
  the same change.

### 32.3 Required visual QA evidence

A UI change is not complete until the agent has:

- Rendered the relevant preview or authenticated surface at wide desktop and
  compact/narrow widths.
- Exercised the changed controls with pointer and keyboard.
- Reviewed at least loading, empty, dense, error/degraded, and normal data states
  when the component supports them.
- Opened menus/dialogs near top, middle, and bottom/edge positions to check
  collision and stacking.
- Checked focus visibility and Escape/outside-click behavior.
- Checked `prefers-reduced-motion`.
- Confirmed no horizontal overflow, covered actions, clipped labels, raw provider
  errors, invalid dates, or layout shifts from asynchronous counts.
- Recorded what was actually viewed and exercised in the handoff. A build-only
  statement is insufficient.

### 32.4 Blueprint change control

The design system may evolve, but not silently. A pull request or commit that
changes a canonical pattern must include:

- The product problem the existing pattern could not express.
- The new reusable contract and which surfaces consume it.
- Responsive, accessibility, state, and provenance behavior.
- Updated visual references or preview fixtures.
- An update to this document when the change is intended to become precedent.

One-off experiments remain explicitly experimental until reviewed. They must not
be copied into other surfaces as de facto design language.

## 33. Source references

Use these existing references when extending the system:

- `desktop/work-os-companion/src/workspace-redesign.css` for current companion tokens and component treatments.
- `desktop/work-os-companion/src/App.tsx` for Today, Tasks, progress composer, task details, and floating Shift/Worktivity patterns.
- `desktop/work-os-companion/src/TodayPreview.tsx` and `TasksPreview.tsx` for focused visual review states.
- `design-qa.md` for the latest reviewed screenshots and known comparison history.
- `src/modules/work-os/EmployeeWorkOsHome.tsx` for the current web employee implementation that must converge on the canonical employee blueprint.
- `src/modules/work-os/ManagerWorkOsHome.tsx` and `WorkOsHome.tsx` for web manager and administrator workflow requirements; their older visual treatment is not precedent when it conflicts with this specification.

This specification is the default, not a prohibition on improvement. A new pattern is appropriate when the existing system cannot express a real product need. When introducing one, document the reason, ensure it composes with the rest of the system, and update this specification if the pattern becomes reusable.
