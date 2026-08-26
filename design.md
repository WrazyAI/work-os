# Work OS product design specification

This document defines the visual, interaction, content, and product-design system for Work OS. It applies to the web platform, desktop companion, onboarding, operational dashboards, employee workspaces, and future Phase 2 surfaces.

The purpose of this specification is consistency. New work should feel like an extension of one product rather than a collection of independently designed pages. Existing implementations may contain older patterns; use this document as the direction of travel when touching those areas.

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

Use a detached floating card for contextual details that should not suspend the page, such as Shift details or Worktivity details.

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
- Keep filters understandable and reversible.
- Preserve the same task behavior as Today.
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

## 23. Source references

Use these existing references when extending the system:

- `desktop/work-os-companion/src/workspace-redesign.css` for current companion tokens and component treatments.
- `desktop/work-os-companion/src/App.tsx` for Today, Tasks, progress composer, task details, and floating Shift/Worktivity patterns.
- `desktop/work-os-companion/src/TodayPreview.tsx` and `TasksPreview.tsx` for focused visual review states.
- `design-qa.md` for the latest reviewed screenshots and known comparison history.

This specification is the default, not a prohibition on improvement. A new pattern is appropriate when the existing system cannot express a real product need. When introducing one, document the reason, ensure it composes with the rest of the system, and update this specification if the pattern becomes reusable.
