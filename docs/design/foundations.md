# Shared design foundations

**Use when:** Any Work OS visual or interaction change; read once per task.

**Owns:** Product character, composition, shared accessibility, and design decisions.

**Implementation starting points:** [styles.css](../../desktop/work-os-companion/src/styles.css), [globals.css](../../src/app/globals.css).

This is the canonical visual and interaction blueprint for Work OS. It applies
to the web platform, the installed companion, the in-app Otto sheet, floating
Otto chat, employee workflows, manager review, administration, and future
operational surfaces.

This blueprint sets the standard for Work OS surfaces: quiet editorial command
centers, strong typographic hierarchy, precise data layouts, generous but
purposeful whitespace, and one unmistakable action per decision area. It rejects
generic card grids, oversized status treatments, colored row rails, and
dashboards that read like decorated forms.

The visual references are:

- The warm, high-contrast command center: a pale canvas, white work surfaces,
  dark ink, compact navigation, and one saturated action color.
- The polished master-detail workspace: a stable left context rail, a flexible
  work stage, clear table rhythm, and detail revealed without losing place.
- The analytical dashboard: a small set of meaningful metrics, restrained
  charts, clear comparison axes, and no decorative visualization.

These references are directional, not assets to copy. Work OS keeps its own
language, truthful data model, Otto identity, approval boundaries, and
provenance labels.

## Non-negotiable product character

Work OS must feel calm, expensive, and useful before it feels expressive.

- Calm under operational pressure.
- Editorial rather than template-like.
- Dense enough for real work, never cramped.
- Soft and tactile without looking glossy.
- Clear about what is live, observed, suggested, saved, queued, or verified.
- Human through language and Otto, not through decorative illustrations.

Every screenful answers, in order:

1. Where am I?
2. What is happening?
3. What needs attention?
4. What is the next useful action?

The first visual level is the outcome or page purpose. The second is the work
surface. The third is controls and content. Metadata is quiet. If every object
is bold, green, boxed, or elevated, the hierarchy has failed.

## Art direction

### Material system

The default light surface is warm ivory, not sterile white. White is reserved
for raised work surfaces and editable fields. Ink is near-black green. Signal
lime is rare and intentional: primary actions, bounded progress, and current
state. Amber and red are semantic alerts, never decoration.

The material stack is:

1. Canvas: warm gray-green/ivory background.
2. Work surface: quiet white or paper panel.
3. Raised surface: white field, drawer, menu, or dialog.
4. Signal layer: a small action, progress segment, or semantic status.

Prefer one large surface with internal rhythm over many nested cards. Use
hairline dividers and whitespace for repeated records. A card exists because it
owns a decision, a summary, or a distinct state, not because an empty area
needs a border.

### Premium composition

Premium does not mean more gradients, shadows, badges, or rounded corners.
Premium means that content has room to breathe and that each edge, alignment,
and number has a reason.

- Use asymmetry when it establishes a clear reading path: a broad task queue
  beside a compact weekly chart; a broad table beside a detail drawer.
- Use a restrained scale contrast: one hero statement, compact labels, and
  tabular operational values.
- Keep the top of a dashboard visually quiet. Avoid stacking an eyebrow, title,
  subtitle, status banner, and duplicate hero.
- Use full-width separators in tables instead of turning every row into a card.
- Use one radius family per surface tier. Do not combine pills, 24px cards, and
  sharp rectangles in the same local composition without a reason.
- Keep decoration behind the content axis and disposable: if a gradient or
  orbit is removed, the page must still communicate perfectly.

### Explicitly rejected treatments

The following are not acceptable in new Work OS surfaces:

- A colored vertical bar or highlighter strip beside a selected task.
- A selected row that shifts its content, changes width, or adds a neon edge.
- A rainbow or glossy gradient used as a permanent panel background.
- A dashboard made of interchangeable KPI tiles with no operational action.
- A card inside a card inside a card when a divider would communicate the same
  grouping.
- A permanently visible diagnostic wall.
- A chart without a question, comparison, unit, or exact accessible fallback.
- A generic sparkle icon used as Otto's identity.
- A successful request described as provider-confirmed without authoritative
  readback.

## Accessibility

Accessibility is part of each module's interface:

- Prefer semantic buttons, links, headings, lists, tables, and dialogs.
- Keyboard access and visible focus for every action.
- Correct tab, dialog, menu, disclosure, and status semantics.
- Focus management and restoration for drawers, sheets, and menus.
- Minimum WCAG AA contrast for text and essential controls.
- State communicated with text/icon/shape in addition to color.
- Touch targets are at least 40px. Compact desktop-only controls may be 34–36px
  when the surface is keyboard accessible and has visible focus; this exception
  does not apply to touch surfaces.
- Meaningful async receipts announced without raw payloads.
- No essential information available only on hover.
- Text zoom and narrow-width resilience.
- Appearance preferences scale text and mascot art without shrinking labels or
  status text (see [appearance preferences](areas/appearance.md)).

## Shared interaction and truth baseline

- Reuse the semantic token roles and existing self-hosted fonts. Named reference
  values belong in the token guide; CSS changes use the owning implementation.
- Give each decision area one primary action with a precise verb. Keep labels
  consistent from control to confirmation, and preserve approval boundaries.
- Keep observed activity, employee claims, suggestions, saved task state, and
  provider-confirmed results distinct. An observation never becomes a score or
  proof of completion. State the source and freshness where they matter.
- Preserve current records during refresh. Loading, no results, local queues,
  failures, and confirmed outcomes must remain distinguishable; keep recovery
  local and preserve the person's input.
- Respect reduced motion, narrow layouts, zoom, and exact-value chart access.
  Detailed behavior belongs in the selected area or pattern guide.

## Applying the supplied design guidance

[Anthropic's frontend-design guidance](https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/frontend-design/SKILL.md)
informs the process: ground choices in the user's task, give structure an
informational purpose, use clear action language, and critique the rendered
result. Before building, state the audience, primary action, layout, and token
roles; check that plan against the brief. Keep expression concentrated and
motion purposeful. For Work OS, the approved palette, font roles, compact
controls, and scoped exceptions are already deliberate choices. This reference
does not authorize replacing them with another aesthetic.
