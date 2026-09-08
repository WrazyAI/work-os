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

The persistent floating companion may use a compact retro-console treatment to
differentiate it from ordinary application chrome: a dark instrument face,
signal-green status readout, and restrained scanline/grid texture on the
collapsed orb only. This treatment
is limited to the companion's identity and bounded-progress display; its expanded
composer remains a flat warm, accessible Work OS surface with standard controls and
plain-language status, free of scanline texture. The console is draggable from its compact body and expanded
header, with a visible keyboard-operable composer once opened.

The `CompanionPet` is the reusable visual identity for that console: a compact,
friendly retro desk robot with state-specific poses. It may appear as a small quiet cue
beside the Today, Tasks, and EOD contexts, but never replaces a status label,
becomes a dashboard card, or competes with a page's primary task action.

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

### 10.3 Tables

Use tables for comparison across repeated columns, not for arbitrary alignment. Tables require:

- Clear headers.
- Stable column meaning.
- Horizontal scrolling at narrow widths rather than illegible compression.
- Useful empty states.
- Row actions that remain discoverable by keyboard.

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
- On the current-day view, use one split hero: today’s agenda/focus on the left and unfinished work from previous days on the right. The left side may expose a compact `Edit focus` action; the right side opens the unfinished-work review flow.
- Do not keep an editable focus textarea permanently open at the top of Tasks. Focus editing belongs in the shared anchored composer so the hero remains a summary and decision surface.
- At compact widths, stack the two hero halves without changing their order or meaning. Historical dates use a single read-only agenda summary rather than presenting current-day actions.
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

## 20. Implementation guidance

### 20.1 Tokens first

Use shared CSS variables or theme tokens for color, spacing, radius, shadow, and motion. Do not reproduce raw values across unrelated components when a token exists.

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
add a 2px danger edge and `Overdue` label. The footer action is
`Mark selected done`, disabled until at least one task is selected, and passes
only the selected IDs to its parent callback. The card itself never mutates a
task or claims Nifty confirmation. It defines loading skeletons, a specific empty
state, a recoverable error with optional retry, a degraded last-known-data notice,
and dense rows. At narrow widths, status labels may hide, metadata wraps, and the
footer action becomes full width. Checkbox focus remains visible and all
non-essential motion is removed with reduced motion.

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
  explicit review in `ToolApprovalCard` before anything is recorded.

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

### 25.11 Assistant chat panel and prompt bar

The in-app dock composer and the floating companion panel share one chat
language (`desktop/work-os-companion/src/WorkOsChat.tsx`,
`work-os-chat.css`), one interaction with contextual modes per §28 — not
lookalike input bars.

Anatomy, top to bottom:

1. **Header:** context tabs on the left, actions on the right. The dock tabs
   are `Update` (or `Agenda` in agenda mode) and `Focus`, switching the
   existing composer panel — never mutating. The companion tabs are `Chat`
   and `Tasks` (with a quiet open-task count); `Tasks` renders the reusable
   task selection card over the live task options with `loading`, specific
   empty, and degraded states, and delegates completion to the existing
   propose-selected flow. Actions are Lucide icon buttons: clear/new/close
   in the dock, new/close in the companion.
2. **Thread:** a fixed scroll region. User turns stay right-aligned soft
   blocks; assistant sections fade up on arrival. Provenance, receipts,
   approval cards, selection cards, and navigation buttons render exactly
   as before — only the container language is shared.
3. **Composer:** context `+` button, auto-growing field, optional labeled
   action (the dock's `Focus` button), and a 36px square 11px-radius dark
   ink send (§28.1). Typing `@` filters Work OS context (today's tasks,
   focus, EOD review, evidence, day summary) and inserts an `@name`
   mention as plain text — mentioning names context, it fetches nothing.
   Typing `/` filters commands: text commands (`/progress`, `/completed`,
   `/blocker`, `/priority`, `/new-task`, `/tasks`) preface the draft so
   classification and approval still happen after send; `/focus` opens the
   focus editor and `/eod` navigates to EOD review, the explicit actions
   the user asked for. One highlight glides between menu rows; menus close
   on outside click and Escape, support arrow/Enter/Tab, and show a
   specific `No matches` state.

Tokens and motion: semantic Work OS tokens only; shells keep their
established borders, radius, and focus rings (the dock shell's ring means
the dock field suppresses its own inner ring to avoid doubling; the
companion shell has no ring, so its field keeps the global one). Entry
motion is 180–220ms with the product easing; all of it is removed under
`prefers-reduced-motion`. The two-row composer layout is derived from the
draft value (newline or labeled action), never from field measurement —
placeholder wrap changes with width, so measurement feeds back into
itself and oscillates.

Deliberate deviations from the exploration reference: no autoplay demo,
no dictation, no model picker, and no rainbow sweep — ambient motion,
saturated multicolor gradients, and unbacked controls violate §§2.4,
2.6, and 6.4. Send is 36px per §28.1, not the reference 28px.

## 26. Today page blueprint

### 26.1 Pre-shift composition

The first screenful is a two-column readiness composition at wide widths:

- **Left primary hero:** readiness phrase, scheduled window, one `Clock in`
  action, and one concise attendance-provenance sentence. Decorative companion
  art may occupy the far right but never displace the action.
- **Right Shift Pulse:** compact countdown/schedule state. The default card does
  not repeat task counts, review counts, session state, or six Worktivity facts.
  Its ellipsis exposes `Worktivity status` in a detached card.
- **Below:** focus and agenda card with today’s focus, `N tasks scheduled for
  today`, and a separate red `M tasks due from yesterday` indicator.

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
26px completion | flexible title + metadata | status | 30px menu
```

Rows are at least 66px high with 11px gaps and neutral separators. On compact
screens, hide the redundant status word before hiding title or completion; the
three-column layout becomes completion, content, menu. Completion remains direct.
Viewing uses the task title/body. Editing, archive, and permanent deletion use the
ellipsis menu.

## 27. Tasks workspace blueprint

### 27.1 Page order

The current-day Tasks page uses this exact order:

1. Page intro and date navigator on a shared baseline.
2. Split agenda hero.
3. View tabs: Today, Unfinished, Completed, All tasks.
4. Search and inclusive date-range toolbar.
5. Task-list panel with local `Add task` action.
6. Sticky agenda/focus composer.

Do not restore a permanently editable focus textarea above the task list.

### 27.2 Split agenda hero

At wide widths the hero is a minimum 184px grid with columns approximately
`1.35fr 0.65fr`; the right column has a practical minimum near 280px.

- **Left, Today’s agenda:** 24–26px padding, quiet green radial wash, focus text
  at 21–30px, `Edit focus`, scheduled task count, authorship/provenance, and save
  state.
- **Right, unfinished work:** neutral or amber surface, 38px state icon, unfinished
  count, number of prior workdays involved, and `Review unfinished work` anchored
  at the bottom.

At `≤900px`, stack left then right. Replace the vertical divider with a horizontal
divider. Historical dates show one read-only agenda panel and omit current-day
mutation controls.

### 27.3 Task views, ordering, and overdue meaning

Tasks are grouped, not presented as an undifferentiated provider dump:

| Section | Membership | Order | Visual treatment |
|---|---|---|---|
| Overdue | Open task with due date before current workday | Oldest due first | Red label/count and 2px danger edge |
| Recent tasks | Open, not overdue | Latest meaningful task activity first | Neutral heading |
| Recently completed | Completed | Latest completion/activity first | Muted completion treatment |

Provider refresh timestamps must not masquerade as meaningful task activity when
a provider-created, provider-updated, completed, or user-action timestamp is
available. Tie-break deterministically by normalized task title.

Malformed provider titles/descriptions, HTML error bodies, `[object Object]`, and
fetch exception text never render as task content. Use `Untitled Nifty task`, `No
description added.`, `Nifty details unavailable`, or another deliberate fallback.
Invalid timestamps never reach a formatter that can throw.

### 27.4 Filtering states

- Search and date range compose with the selected view; neither silently resets
  the other.
- Show `N results` whenever filters are active.
- The filtered-empty state is `No tasks match these filters` plus a clear-filters
  action. It must not say the user has no tasks.
- The unfiltered empty state reflects the selected view: for example, completed
  tasks will appear after completion.
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
employee-authored bottleneck remains separate. The AI request receives the report
narrative and feedback, never the bottleneck answer. When every task in the
current-day list is complete, disable the bottleneck field, clear any prior value,
and omit the bottleneck section from the submitted report. Otherwise the employee
must provide a bottleneck before submission. A failed refinement preserves both
the report, feedback, and bottleneck input.

### 29.2 Insights

Insights follows summary → comparison → exact record:

1. Page intro and Day / 7 days / 30 days range control.
2. A small metric row for separate evidence classes, never a composite score.
3. Evidence-based brief with Wins, Needs attention, and Next focus.
4. Trend visualization when at least two comparable dates exist.
5. Exact-values table or drilldown for auditability.
6. Source freshness and limitation note.

Use no more than four primary metric tiles in the first row. A tile is at least
126px high on wide desktop and contains one icon, label, and value/progress object.
Observed duration, daily-task completion, Nifty outcomes, and output evidence use
separate labels and scales. A dual-series chart must provide a legend that names
both scales; it may not visually imply that activity time and task completion are
the same measure.

Charts reserve their geometry while loading, include exact accessible text, and
fall back to a table at narrow widths. Stale data remains visible with a local
freshness notice rather than disappearing behind a spinner.

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

Each setting row uses a flexible label/description column and intrinsic control
column. Rows are normally 72–104px high depending on helper copy. At narrow widths,
stack the control below the explanation and make it full width when appropriate.
Do not place unrelated settings in dashboard metric cards.

Provider connections show provider name, mapped identity/workspace, last verified
state, and a clear reconnect or inspect action. `Connected` requires a verified
provider-scoped read, not the presence of stored credentials. Destructive settings
live in a separated danger section and require explicit confirmation.

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
| Narrow/tablet | approximately `720×900` | stacked Tasks hero, compact rail/navigation, composer clear of rows |
| Small | approximately `390×844` | single-column content, touch targets ≥40px, no horizontal page scroll |

Specific collapse rules:

- At `≤1120px`, collapse rail labels before compressing task content.
- At `≤900px`, stack split heroes and search/date controls.
- At `≤560px`, stack the active-day header and footer actions, hide redundant task
  status labels, make task tabs share available width, and use two columns for
  detail facts.
- Long task titles and focus statements wrap where they are primary; dense task
  rows clamp descriptions to two lines.
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
