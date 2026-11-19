# Modular design guides implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` for this documentation refactor. The original user request and the constraints below govern the work.

**Goal:** Let an agent load the Work OS design rules relevant to a task without reading the entire blueprint.

**Architecture:** Keep `design.md` as a short router. Shared foundations establish the product identity; focused guides own screen and interaction contracts. Conditional dependencies and a legacy section lookup make selective reading explicit.

**Tech stack:** Markdown, existing repository checks, temporary link and source-coverage audits.

**Spec:** The user's November 18 request to separate the current guide by app area/category, retain shared principles, and use Anthropic's frontend-design guidance. The user authorized implementation in upstream `WrazyAI/work-os` through `zahemen9900` and delegated unavailable ledger logging to the local agent.

## Global constraints

- Preserve approved Work OS design, token values, product behavior, evidence/approval boundaries, and accessibility requirements.
- Adapt Anthropic's design process to the established product; do not introduce a product redesign.
- Retain the root entry point and replace the whole-document reading instruction in `AGENTS.md`.
- Use ordinary Markdown and explicit task routing; no new runtime dependency or loader.
- Work from `804bc8e3b940713a443add29a8f1b2da39d97ec0` on `codex/modular-design-guides`. Leave the source checkout unchanged.
- No merge, deployment, release, or version change is part of this task.

## Approach

Use a router plus shared foundations, area guides, and conditional pattern guides. A simple chapter split would leave unrelated material together; a summary-only rewrite would risk losing precise requirements. Preserve the detailed contracts in their owning guides and rewrite the navigation, local introductions, and dependencies.

## Review focus

- Every original requirement has a destination; no meaningful prose disappears during extraction.
- Links and anchors resolve after moves; duplicate old section numbers remain distinguishable by title.
- A focused task does not recursively require the whole collection.
- Shared requirements, surface exceptions, and historical reports have clear authority.
- Existing read-all instructions and paths continue to route agents correctly.

## Tasks

- [x] Inspect current main, agent rules, blueprint, source consumers, and supplied Anthropic guidance.
- [x] Establish an isolated worktree and run the existing surface guard (4 tests passed).
- [x] Split and organize the canonical contracts; add focused reading headers and cross-guide links.
- [x] Replace the root blueprint with a router; update agent/README entry points and historical QA labeling.
- [x] Verify source coverage, Markdown paths/anchors, representative reading paths, and the existing surface guard.
- [x] Obtain one independent review of the completed documentation changes and address actionable findings.
- [x] Prepare the reviewed diff and validation summary for upstream publication through `zahemen9900`.

## Progress and decisions

- The source guide contains 2,896 lines / 28,373 words. No runtime code or tests parse its prose; the existing surface guard checks that `design.md` exists.
- The original has two headings numbered 8.17. The legacy lookup will preserve both titles instead of silently resolving the number to one of them.
- Older specs contain section numbers absent from this baseline. Historical records remain historical and can be resolved through Git history; the refactor will not invent missing contracts.
- Validation is scoped to documentation integrity and existing direct consumers. Application build/typecheck/render gates remain required for future UI changes; this task changes no UI.

## Validation and review record

- The root router is 84 lines / 706 words. The collection has 43 focused guides plus an administration index, maintenance guide, and legacy lookup. Representative reading paths, including foundations and verification, use approximately 76–89% fewer words than the former complete blueprint.
- A temporary migration audit checked all 81 source spans. Only five structural headings were replaced; the audit tracked the editorial clarifications separately. All 46 guides are reachable, 532 local links and anchors resolve, and required-reading dependencies have no cycles.
- `node --test test/work-os-surface.test.mts` passes all four existing checks on both the baseline and the refactor. Whitespace checks pass. The application build, typecheck, full test suite, and rendered UI checks were not run for this Markdown-only change.
- Independent review covered source preservation, selective reading, role/surface boundaries, and the Anthropic adaptation. Its actionable findings were addressed in one integrated pass: employee row geometry, companion Profile and Evidence scope, flexible-work timing, manager Team review routing, precise conditional links, and the current composition example.
- The existing possible flexible-EOD client/server discrepancy is recorded beside the owning gate and in the legacy lookup. Runtime parity, historical screenshot accuracy, and completion of older plans remain outside this documentation refactor; no UI fix is claimed.
- The local CodeRabbit CLI is unavailable in this environment. The repository's configured automatic PR review can run after publication; its result is not implied by the independent review above.

## Delivery

Publish `codex/modular-design-guides` directly to `WrazyAI/work-os` and open a PR against `main` through the authorized `zahemen9900` connection. Record the resulting URL and live review status in the delivery handoff. Ledger logging remains with the user's local agent, as explicitly directed. This plan records the verified changes prepared for publication; merge, deployment, and release remain separate actions.


## November 19 integration

The user authorized merging PR #179. Its original head passed the full CI
workflow, including Work OS typecheck/tests, site and film checks, production
build, companion tests/build, Rust checks, release policy, and CodeQL. CodeRabbit
remained neutral after its rate-limited attempt.

Main advanced to `0bacb51bf4338528d894c2713cbbb432bc8c2a77` and changed the
monolithic blueprint. The conflict resolution keeps the root router and ports
all four new contracts to their owners: debugger categories and platform chrome,
vertical navigation semantics, workspace-scoped companion arrivals, and debugger
category cleanup. It also links the new recap operations guide conditionally.
Incoming application, release, research, and operational documentation changes
are retained unchanged. A bounded independent audit identified these deltas;
validation and merge status for the combined commit are recorded in the PR and
final handoff.

The combined run exposed a pre-existing release-metadata failure also present
in main's CI run `44563990253`: the companion package and Tauri/Cargo metadata
declare `0.5.39`, while both root version fields in its npm lockfile still
declare `0.5.38`. The existing desktop static guard fails on that mismatch.
The merge prerequisite corrects only those two lockfile fields to `0.5.39`;
dependency records and the declared app version are unchanged. The same guard
was reproduced failing locally and passes after the correction. Full CI is
required again on the final branch before merge.
