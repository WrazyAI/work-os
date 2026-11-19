# Workflow dialogs and submission confirmations

**Use when:** Changing Plan your day or EOD input, drafted review, refine, submit, or recorded confirmation.

**Owns:** Two-view modal structure and honest plan/EOD submission receipts.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing plan content or focus: [Planning, focus, and suggested goals](../areas/planning-and-focus.md).
- Changing eod content or availability: [Employee EOD review](../areas/eod-review.md).
- Changing transition timing: [Motion and reduced motion](motion.md).

**Implementation starting points:** [PlanningSession.tsx](../../../desktop/work-os-companion/src/PlanningSession.tsx), [EodSubmittedReport.tsx](../../../desktop/work-os-companion/src/EodSubmittedReport.tsx).

## Two-view workflow modals: input view and drafted view

A workflow modal that produces a reviewable draft keeps the input and the draft
apart. The modal opens on the input view; the moment the draft is ready it opens
its own view, so the drafted document never stacks under the input and never
forces a scroll to reach it. The planning session (`Plan your day`) is the
reference implementation.

- **Input view** — the intent field, any attached source (such as a Loom
  recording), and the one primary action that produces the draft (`Build my
  plan`).
- **Loom source** — a recording link, a pasted transcript, or both. A pasted
  link is read automatically when Build is used, so reading it is never a
  separate prerequisite; if Loom says the recording is not usable for the day,
  the build stops on that verdict. A transcript pasted without a link is still
  the employee's own copy of the recording's words: the draft may use it, but
  the surface never claims a verified date, title, or length.
- **Drafted view** — the review document with its own in-place actions (edit,
  delete), starting at the top of the body with no inherited scroll position.
  Focus follows into the view so keyboard and screen-reader users land on what
  changed.
- **Plan summary** — the drafted summary states the day's focus in one or two
  sentences, written as the goal. It never describes the source or the
  analysis: no Loom/transcript provenance, no recording date, no missing task
  IDs or linking notes, and no "completion is not assumed" caveat. Source
  limits shape how confidently the commitments are linked, not the summary
  copy.
- **Back** — the drafted view carries one quiet Back control in the dialog
  header's top-left corner. It returns to the input view and keeps the draft;
  nothing is discarded, and the primary action then reads `Review draft` so the
  way back to the reviewed document is always one click.
- **Delete** — deleting the draft (the double-confirm trash) returns to the
  input view and clears the draft.
- **Footer** — exactly one primary forward action per view: `Build` on the
  input view without a draft, `Review draft` on the input view with a kept
  draft, and `Confirm`/`Save` on the drafted view. Close and the secondary
  actions stay available in both views.
- **Copy** — the modal ships only copy the surface cannot carry itself. Helper
  lines that explain mechanics ("your words stay attached", "nothing is filed
  until…") are omitted; the input, the readback card, and the review document
  state the contract through their own structure.

## Submission confirmations: plan and EOD

A submitted plan or EOD ends with one honest confirmation, never a receipt line
that scrolls away:

- The start-of-day plan replaces its workspace the instant the write lands: the
  plan modal closes and a compact confirmation dialog takes the moment, holding
  the checked animation on its completed frame, one line of outcome copy, and a
  single `OK`. There is no close glyph, no second action, and no auto-dismiss;
  `OK`, Escape, or a press outside the card dismisses it.
- The EOD keeps the page. The submitted state embeds the same animation where
  the report was, with the outcome copy and `All EODs` at the top-left returning
  to the EOD list; it stays until the employee leaves it. Reopening a submitted
  or approved report later shows the same confirmation above the read-only day
  edition, with `All EODs` and `Return to today`; the report is never presented
  as an editable draft again.
- The animation plays exactly once and parks on the completed check. The source
  art fades its check out over the final frames, so the completed state is the
  held frame — never the faded tail. Under reduced motion the completed frame
  renders statically, and the art stays decorative (`aria-hidden`); the heading
  and copy carry the meaning.
- Player and renderer stay local: the bundled wasm and the `.lottie` asset ship
  with each app, and static assets are never auth-gated into a redirect.

## Focus, finder, and workflow transitions

The focus strip uses 160–220ms for its hover, chevron, and recorded-done meter;
the focus dialog arrives over 220ms with a 10px translation and leaves over
180ms; the task finder panel arrives over 220ms and leaves over 160ms. Their
backdrops fade with them. The focus plan's subtask disclosures use a 220ms
height-and-opacity transition. Reduced motion removes every one of these while
preserving the same states and geometry. The Plan your day session hands off
between its input, drafted review, and recorded confirmation without replacing
the modal backdrop. Compose/review
content enters over 210ms with a 7px translation; recorded confirmation enters
over 240ms with a 9px translation, using the product easing. Review focus and
the confirmation state persist when motion is reduced, with nonessential
animation removed.
