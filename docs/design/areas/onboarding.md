# First run and setup

**Use when:** Changing the connect screen, welcome stage, setup steps, or completion handoff.

**Owns:** First-run composition, spoken copy, journey rail, controls, and motion.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing workspace choice or device connection: [Workspace identity and device connection](workspace-identity.md).
- Changing profile or arrangement setup: [Profile, connected accounts, and work arrangements](profile-and-schedule.md).
- Changing first-login theme sequencing: [Appearance and first-login theme choice](appearance.md).

**Implementation starting points:** [Onboarding.tsx](../../../desktop/work-os-companion/src/Onboarding.tsx), [OnboardingStage.tsx](../../../desktop/work-os-companion/src/OnboardingStage.tsx), [OnboardingSetupModal.tsx](../../../src/modules/work-os/employee/OnboardingSetupModal.tsx).

The employee has not met the product yet, so first run is the one surface where
the companion carries the experience instead of annotating it. Otto is on stage
from the first frame to the last, and the panel beside him stays in the quiet
product language: personality on the stage, discipline in the panel.

- **The connect screen.** The stage's first frame, before any session exists:
  one statement, Otto's line carrying the secure browser sign-in in his own
  voice, and one `Connect workspace` action with a short `About a minute.`
  note. The advanced server override stays a quiet disclosure in the bubble,
  beside the action it changes, and the screen carries no journey rail; the
  sign-in round-trip returns to the same world setup opens on.
- **The welcome.** A full-width stage holding one statement, Otto, and his
  spoken line, with one `Start setup` action and a short `Six short steps.`
  note. It appears only for a draft that has never been written
  (`draft.updatedAt` is null and the draft is on the first step). Any other
  entry — a resumed draft, a returning employee — lands directly on the step
  the draft holds, and no welcome is shown or replayed.
- **The step screen.** A split view. The stage carries the step's purpose as
  one eyebrow and one statement, then what Otto says; the panel carries exactly
  one heading, which is the concrete instruction, and the work itself. Neither
  column repeats the other: the reasoning lives in the spoken line, the
  instruction lives in the panel, and the truth-bearing copy (the consent
  sentence, the schedule precedence note, the attendance status) stays where it
  can be read in full.
- **The journey rail.** Six stops under the stage: completed, current (wider,
  in signal), and upcoming. It is absent from the welcome, since nothing has
  started. Its accessible name states the position and the step
  (`Setup progress: step N of M, <label>`), and one polite live region
  announces the same sentence once per step rather than reading the stage aloud.
- **What Otto says.** The spoken line is the only place the step's reasoning
  lives, and it is spoken in his voice, not explained in the interface's. The
  full sentence is exposed to assistive technology once, prefixed with the
  configured name; the resolving words are `aria-hidden`. Nothing in a line
  may overstate what the step does.
- **Poses.** Attending while the employee answers, working while the workspace
  is really being prepared, and celebrating at the completion. Each recipe
  names a genuine agent/workday pair through the shared state layer; the stage
  opts out of the application runtime because there is no workspace state for
  it to mirror yet.
- **The hand-off.** The completion states the truthful attendance status and
  offers one `Enter My Day`. Choosing it puts Otto in his working pose and
  shows the inline wait, and that state lasts exactly as long as the transition
  takes — never a fixed or invented delay.
- **Leaving.** Session controls sit in the same top-right corner on the welcome
  and on the step masthead, so `Sign out` is reachable from the first screen and
  never moves between them. A first run that cannot complete is never a dead
  end. Session controls appear once: the stage owns them, and the step panel's
  masthead carries only its label.
- **The controls.** The panel is the instrument to the stage's personality, so
  its craft is depth and state rather than decoration. One raised field tier
  (white, 12px radius, a top highlight, a hairline) and one inset tier for the
  values the workspace supplied, so a supplied fact never looks like an empty
  field waiting for input. Field labels are sentence case 11–12px: an uppercase
  tracked label is an eyebrow, not a label. Selection is a real control —
  archetype cards, specialty chips, and the weekday track carry `aria-pressed`
  and a selected treatment that reads without colour. Validation is inline: the
  unanswered control takes `aria-invalid` and a message beside it in a live
  region, and `Continue` moves focus to it; an answer that is a set rather than
  a field (the archetype cards, the weekday track) puts the message in the flow
  and takes focus itself. The save state names the state and never an internal
  revision number.
- **Narrow setup actions.** At 720px and below the stage and setup content may
  scroll as one page, but Back, save state, and Continue remain anchored to the
  viewport bottom before any scrolling. Reserve the bar's height and safe-area
  inset beneath the content so the last field remains reachable. The narrow
  panel skips its container-transform entrance (which would capture the fixed
  bar); step-content entrances remain, with the existing reduced-motion rule.

## Step motion

First run adds exactly one entrance per step and nothing else: the step
statement and the spoken bubble each arrive over at most 260ms with a 6px
translation, and the spoken line resolves word by word at 26ms per word, capped
at 48 words, then stops. The reveal is CSS with no timer, so it cannot outlive
its line, replay on its own, or compete with anything else animating. Reduced
motion renders every one of those states flat. A step change moves in the
direction the employee moved (forward or back) so the panel's arrival explains
what changed.
