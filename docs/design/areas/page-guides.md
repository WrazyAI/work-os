# Page guides and workspace tour

**Use when:** Changing first-visit guides, replay, guide films, chapters, opt-out, or the tour.

**Owns:** Guide presentation and recorded-interface film contracts for employee and admin pages.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing film generation, manifests, loading, or budgets: [Shared seams and performance budgets](../implementation.md).
- Changing guide preferences or the filmed settings layout: [Settings categories and layout](settings.md).

**Implementation starting points:** [PageGuide.tsx](../../../desktop/work-os-companion/src/PageGuide.tsx), [usePageGuides.ts](../../../desktop/work-os-companion/src/usePageGuides.ts).

Every primary workspace page carries exactly one guide: My Day, Tasks, EOD
Review, Insights, and Settings. A hidden destination (Evidence) has none, and
there is never more than one guide per page.

- **First visit** — the guide opens once after a short beat, once flags are
  known. Dismissing it through `Got it`, close, backdrop, or Escape marks it
  seen for the account (`work_org_members.ui_state` through
  `/api/work-os/me/guides`), so it never auto-opens again on any device. A
  visit that is skipped because another
  overlay owns the screen, because onboarding is incomplete, or because flags
  could not be loaded is not marked seen and is re-evaluated on the next visit.
- **Any time** — one icon-only `?` control in the masthead (accessible name
  `How <page> works`) reopens the guide for the page on screen. Reopening by
  hand does not consume an unseen guide; acknowledgement happens on dismissal.
- **The film** — the modal's illustration is film of the real companion: one clip
  per numbered step, shot by `scripts/shoot-guide-films.mjs`. The gates and the
  shape are the contract:
  - Clips are recorded against the offline fixture boot and never against a live
    account. Nothing is written, and no footage shows a state an employee cannot
    reach.
  - Every click in a clip is a real click on a real control, and what the
    interface did about it is what lands in the film. No state is staged and no
    behaviour is mocked.
  - One clip per page per step, encoded H.264 MP4 at 1000×500 with a still
    beside it. H.264 because every runtime this ships to plays it; MP4 rather
    than WebM because the packaged webviews are the constraint, not the browser.
  - The camera and the pointer are the shooter's, not the product's. Neither is
    a feature of the interface and neither appears outside a guide.
  - `src/guideFilms.ts` is generated from the encoded files, and a test asserts
    one clip per step, both files on disk, and each chapter label matching its
    step title. These assertions do not detect instruction-only or filmed-control
    changes. Follow the [film checks and visual-review requirement](../implementation.md#performance-budgets)
    and re-shoot chapters that no longer demonstrate the current step.
- **The modal** — `role="dialog"` with `aria-modal`, labelled by its title and
  described by its promise. It is a split view by default: the film plate is
  the left column and the script — header, chapters, actions — is the right.
  The plate sits on the companion's ink so the real, light interface reads as
  something projected rather than another card; its slate names the source and
  the current chapter, and its caption names the clip and its length. Below
  880px the guide returns to one column in reading order: header, film,
  (tour rail), chapters, actions. Its header names the speaker once, with the
  configured companion mark for sighted readers and the configured name for
  assistive technology, so a guide reads as the same companion the employee met
  in setup. It plays straight through on open: step one's clip runs and its end
  hands over to step two. The numbered steps are the film's chapters — choosing
  one jumps the film there and it carries on from there. It has at most three
  numbered steps as an ordered list, each showing its clip's length, and one
  primary `Got it`. There is no seek and no transport control beyond choosing a
  chapter, so no clip depends on range requests. While automatic guides are on
  it also offers one quiet `Don't show these automatically`; once off, the footer
  states that automatic guides are off and points at the `?` instead.
  - Hovering a step does not start it. Hover is how you read a list, not how you
    ask to watch six seconds of film.
  - The active chapter is stated in place by an inset surface, a hairline
    border, and a filled mark, not by colour alone; the list stays a sequence
    rather than a stack of competing cards. It never adds a rail beside a
    content row: that marker belongs to the primary navigation only ([navigation states](desktop-shell.md#navigation-states)).
  - The footage is `aria-hidden`: the step copy states everything the clip shows,
    in words, and that is the accessible path. No meaning is film-only. The
    plate's slate and caption are part of that frame and are hidden with it; the
    reduced-motion `Play this step` control is not, because it is the employee's
    way into the clip.
- **The tour** — `GuideTour` plays all five films as one pass, started either by
  the first guide a new workspace shows (`Show me the whole workspace`) or by
  `Replay the full tour` in Settings. Choosing a page in its rail navigates the
  real application to that page, so the walk is through the product rather than a
  carousel laid over it, and closing it leaves the employee on the last page it
  showed. It never changes page on its own; within a page its chapters advance as
  the page guide's do.
- **Dismissal** — Escape, backdrop press, and the close control dismiss it; in
  the split view the chapter list is the only scroll region (in the narrow
  layout it scrolls under the film); focus lands inside on open and returns to
  the `?` after. Below 560px the modal takes the viewport inset, and on the tour
  the progress track is dropped before any page name is truncated.
- **Reduced motion** — nothing plays. The still frame stands in for the clip,
  every chapter stays selectable, and one control plays a chapter on request.
  Labels, order, and copy are unchanged.
- **Opt-out** — Settings → Page guides switches automatic guides; the modal's
  quiet action writes the same account flag. The `?` keeps working either way,
  and the tour stays available from Settings whatever the flag says.
- **Administration** — the seven administration sections carry the same guide
  contract with their own keys (`admin_overview` … `admin_settings`): one
  first-visit pass per section, the masthead `?` replays it, and the first
  administration guide offers the workspace tour, which walks the seven
  sections in order and moves the real workspace. Every administration page is
  filmed like the employee pages — shot through the admin-shell fixtures boot —
  so all twelve guides play film; the modal, flags, and opt-out are shared,
  never a second copy, and the administration Settings page carries the same
  Page guides group — the automatic-guides switch and `Replay the full tour`,
  which walks the administration workspace.

## Reduced-motion film behavior

The guide film answers to the same rule, which for video means not playing it at
all: under reduced motion the still frame stands in, every chapter stays
selectable, and one control plays a chapter on request. Film never autoplays on
its own outside a guide the employee opened, and no clip ever loops.
