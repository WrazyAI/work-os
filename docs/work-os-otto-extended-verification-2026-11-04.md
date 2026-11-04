# Extended Otto walkthrough — implementation record

Feature: **A workday with Otto — an extended look** plus the requested short-lesson
rename. Worktree `codex/work-os-otto-extended`; ledger
`06af32f7-731d-49ec-a71e-5121461c4d46`.

## What shipped

- `companion-chat` is now **Use Otto, the floating companion** in the shared
  manifest, so the library card and lesson heading agree.
- A new 199.684-second lesson, **A workday with Otto — an extended look**, at
  `/work-os/tutorials/otto-extended`. One continuous MP4 with eight numbered
  topic intros and explicit chapter jumps (`01`–`08`). No automatic playback.
- Each part demonstrates floating Otto first, then the in-app equivalent:
  1. ask for a workday summary; 2. ask for unfinished work and inspect the real
     pending-task result; 3. follow the agenda nudge into planning and confirm a
     plan on both surfaces; 4. hear the actual recap read aloud on both surfaces;
  5. confirm the recap in the compact bubble, then an alternate in-app review;
  6. decide each next-step suggestion individually in both surfaces; 7. review
     an earlier recap from floating Tasks and the in-app Focus stream; 8. follow
     the EOD reminder into the report, submit deliberately, and view the result.
- The film uses the current companion with isolated filming adapters. No
  production AI, auth, API, attendance, or vault source changed.

## Deliberate boundaries

- Chat has no dedicated historical EOD-status lookup. The demo answer for “Did I
  submit yesterday's EOD?” points at EOD Review instead of inventing a yes/no.
- Floating recap history lives under **Tasks**; in-app history lives under
  **Focus**. The main Tasks workspace is never presented as the recap stream.
- Recap confirmation does not complete tasks; each next-step proposal needs its
  own decision.
- The compact confirmation take continues the recap already played in the prior
  part; that preparation is excluded from the film soundtrack.

## Verification

- 8/8 paired-surface preflights and 16/16 recorded surfaces passed with zero app
  errors and zero backend contact. Outcome stills inspected for every part.
- Final media: H.264 High, 1440×900, 60/1 fps, 11,981 frames, AAC audio, 199.684
  seconds, 11.7 MB. VTT includes spoken-word cues timed to the actual voice
  sample. Original instrumental music ducks under the recap voice.
- Chapter jumps seek the single paused player and load metadata once; an explicit
  play control is still required. Wide layout two columns, narrow one column, no
  horizontal overflow.
- TestSprite `d744b581-c319-4585-b506-e85acb041ed8` passed twice against
  localhost:1447; a generic baseline test `7780edd4-d9ed-498f-bc96-f3a8c37e2f31`
  also passed. The generated tests store no per-step receipts, so the verdict is
  supported by direct browser checks of heading, controls, seek time, and real
  playback.
- CodeRabbit CLI 0.9.2 is authenticated but its review endpoint rejected the
  session (“could not be authenticated”). A separate independent review covered
  the branch; its findings are recorded in the ledger.
