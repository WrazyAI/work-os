# A workday with Otto — approved film design

Ledger: `06af32f7-731d-49ec-a71e-5121461c4d46`.
User approved the interactive eight-part storyboard and requested implementation.

## Outcome

Keep the ten existing films. Rename `companion-chat` to **Use Otto, the floating
companion** in the shared manifest so the library and lesson heading agree.
Publish one additional film, **A workday with Otto — an extended look**, at
`/work-os/tutorials/otto-extended`. It is one continuous MP4, not eight videos.

## Editorial structure

Approximately four minutes, eight parts of about25–30seconds; extend a dense
part rather than omit a decision or make the text unreadable. Brief numbered
title transitions introduce each topic without using the word Chapter.
Every shared capability is demonstrated floating first, then in-app, with
clear alternate-take labels where a decision cannot sensibly be repeated.

1. Ask about your workday: send “Summarize my workday so far”, read a grounded
   answer in floating chat, then demonstrate the equivalent in-app conversation.
2. Find unfinished work: ask about open tasks, show the pending-task tool result
   and inspect it on both surfaces. A question does not mutate anything.
3. Start with a plan: actionable agenda ping → Set today's goal → main app
   planning handoff → draft/review/confirm; show the direct in-app entry too.
4. Listen to a recap: actionable arrival, explicit Listen, real audible recap
   matching the displayed text, speaking pose/prompter. Demonstrate the supported
   in-app listening equivalent; label any actual surface limitation honestly.
5. Confirm without opening chat: compact Looks good, Saving and settled outcome.
   Then a labelled alternate take: in-app Focus, inspect evidence, confirm/amend.
6. Decide next steps: compact grounded suggestions, accept a completion, edit/add
   new work, skip another item; demonstrate the in-app per-item decisions too.
7. Catch an earlier recap: floating Tasks → Recent activity → older Not reviewed
   interval → inspect/review; View in app opens the in-app Focus stream.
8. EOD reminder → Open EOD review → actual main-window handoff → review/submit/
   confirmation; show direct in-app entry and an earlier report's recorded state.

## Truth and production constraints

- Capture the real current companion controls against isolated DEV fixtures.
  Fixture adapters may supply coherent fictional data and local handler responses;
  they must not forge DOM outcomes or bypass real review/action components.
- One internally consistent fictional employee/day. No employee sessions, backend
  writes, real provider mutations or credential-bearing footage.
- The interpreter can use tasks and optional Work Memory day/profile/history.
  EOD submission stores report content in memory, but chat has no dedicated
  historical submission-status query. Do not invent a definitive chat answer to
  “Did I submit yesterday's EOD?” Use the report record instead.
- Floating recap history lives in Tasks; in-app history lives in Focus. The
  main Tasks workspace is not the recap stream. No invented navigation controls.
- A confirmed recap is activity context, not completed work. Each next-step
  proposal requires its own explicit decision; show actual receipts.
- 1440×900 H.264, genuine60fps, AAC, self-hosted Inter, original instrumental
  music and English VTT. Duck music underneath actual recap speech. A silent
  speaking animation does not satisfy the audio requirement.
- Scene-aware captions never cover active controls or spoken text. Numbered
  interstitials use the existing ink/paper/signal style and configured mascot art.
- Reuse VPS scratch for capture/render/encode/mix; never touch active `.next`.
- Do not change AI capabilities, auth, attendance, installer versions or release
  queues for a tutorial/DEV-fixture-only change.

## Acceptance

Preflight every real action and assert its visible outcome before expensive
capture. Verify paired-surface coverage, eight transitions, no backend contact,
voice/text alignment, codec/frame rate/duration, VTT and poster. Inspect rendered
frames from every part, native playback/seek, and desktop/narrow public pages.
Run focused tests, typecheck, full suite, TestSprite for the new flow, and one
completed-batch CodeRabbit review. Port only bounded website/media changes to
Agent OS and deploy atomically under the existing authorization. Verify live
page titles, media hashes, range requests, captions and playback afterward.

Builder choices: keep the existing rig and add a dedicated extended-film adapter
rather than rewriting ten accepted films. Use one chapter metadata list to drive
the editorial interstitials and optional player chapter links; no autoplay.
