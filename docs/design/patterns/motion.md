# Motion and reduced motion

**Use when:** Changing animation, transition, hover movement, or automatic playback.

**Owns:** Default timing, restrained transforms, and the universal reduced-motion contract.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing focus, finder, or workflow transitions: [Workflow dialogs and submission confirmations](workflow-dialogs.md).
- Changing first-run motion: [First run and setup](../areas/onboarding.md).
- Changing the loading exception: [Startup and the local vault gate](../areas/startup.md).
- Changing bounded attention motion: [Floating companion, Otto, and assets](../areas/floating-companion.md).
- Changing video playback: [Page guides and workspace tour](../areas/page-guides.md).

Motion explains a state change:

- Hover/focus: 120–180ms.
- Button/row state: 150–220ms.
- Drawer/popover: 160–240ms.
- Progress interpolation: 300–420ms.
- Row completion exit: short and layout-true.

Use small transforms only: a 1px hover lift, 4–9px entry translation, or
approximately .985 press scale. No ambient loops, bouncing, overshoot, or
theatrical dashboard animation.

Respect prefers-reduced-motion. Remove transforms, shimmer, and nonessential
animation while preserving state, labels, and final geometry.

## Scoped exceptions and timing owners

The default above allows the specifically approved loading-wait loops in
[First Light](../areas/startup.md#first-light-and-morning-rise), the bounded
[Otto attention sequence](../areas/floating-companion.md#attention-sequence),
and the one-shot entrances described in the affected area guide. These do not
authorize ambient animation elsewhere. Use the owning surface's exact timing
when it specifies one; all reduced-motion requirements still apply.
