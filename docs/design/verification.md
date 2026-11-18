# Design verification and handoff

**Use when:** Planning acceptance for a UI change or preparing its handoff.

**Owns:** Rendered evidence, interaction review, and the implementation checklist.

**Requires:** [Shared foundations](foundations.md) (read each once per task).

**Read next only if:**

- Selecting viewport classes: [Responsive layouts and viewport matrix](patterns/responsive.md).
- Verifying microphone states: [Voice input](areas/voice.md).

**Implementation starting points:** [work-os-preview](../../src/app/work-os-preview), [main.tsx](../../desktop/work-os-companion/src/main.tsx).

A UI change is incomplete until the rendered result is inspected. Theme work
adds the second material to every item below; a surface that was only checked
in Light is not verified. The required evidence for a dashboard/task change is:

1. Wide normal state at 1440px or equivalent.
2. Compact desktop state around 1024px.
3. Narrow/mobile state around 390px.
4. Pre-shift, active, observed/degraded, empty, and dense task states.
5. Selected, hovered, keyboard-focused, menu-open, and drawer-open states.
6. A completion/add-task flight with the rest of the list still usable.
7. Reduced-motion render.
8. A check for horizontal overflow, covered controls, clipped labels, and
   asynchronous layout shift.

A voice input change adds the capture states to that list: idle with an empty
draft (the record control in the send slot), idle with text (the send back),
requesting, recording, transcribing, the transcribed receipt, and the
permission-denied and no-speech failures — at wide and narrow widths, in both
themes where a dark variant exists ([color tokens](tokens.md#color)), and under reduced motion.

The selected-row review specifically asks:

- Is the row selected without a colored rail?
- Does its geometry remain stable?
- Can a keyboard user see focus?
- Does the same state look intentional at dense and narrow widths?
- Does it remain visually subordinate to the task title and action?

Record what was actually rendered and exercised. A build or static assertion is
not visual acceptance.

## Implementation checklist

Before editing:

- Read the [design index](../../design.md), shared foundations, and the
  guides selected for the affected area and behavior.
- Inspect the current implementation and the latest reviewed preview.
- Check the shared chat seam and mascot source before touching adjacent surfaces.
- Inventory existing tokens, task-row behavior, drawer behavior, and preview
  fixtures.
- Write down any intentional deviation.

During editing:

- Use semantic tokens and shared seams.
- Keep selection driven by aria-selected.
- Never add a colored content-row rail.
- Preserve approval/provenance contracts.
- Add deterministic model/render coverage for new visual states.
- Keep the changelog entry employee-readable.

Before handoff:

- Run build, typecheck, and relevant tests.
- Review screenshots, not only DOM assertions.
- Follow the verification and review steps in `AGENTS.md`.
- Report branch/commit, rendered states, interaction checks, and anything not
  deployed.

This blueprint is the default for new Work OS work. A deviation is allowed
only when it solves a real product or accessibility need and is documented in
the implementation and the next blueprint revision.
