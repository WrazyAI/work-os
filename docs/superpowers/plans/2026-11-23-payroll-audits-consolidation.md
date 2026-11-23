# Payroll Audits Consolidation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline.

**Goal:** Make Payroll the one place for new audits, findings, and payroll records; keep activity reporting in Insights.

**Architecture:** Use the existing Work OS payroll routes, deterministic calculation, retained analysis revisions, and admin authorization. Do not restart the legacy Codex audit pipeline or copy its data into payroll.

**Tech stack:** Next.js App Router, React, TanStack Query, PostgreSQL.

**Spec:** User brief in ledger task `86af5a34-6d30-4f61-8e3e-c51b31faf4de`; existing payroll protections remain in `docs/superpowers/specs/2026-11-16-work-os-payroll-review-design.md`.

## Global constraints and review focus

- Preserve direct review and print links, approval/retention behavior, and screenshot restrictions.
- A new audit selects a mapped employee and pay date, queues a durable run, and opens that exact review.
- Keep failures, empty periods and queued runs distinct; never interpret missing coverage as idle time.
- Legacy reports are retained in storage, not imported or represented as payable hours. The old pipeline used different authorization, evidence rules, and a different model.

## Work

- [x] Render-test default Records, the New audit destination, and detailed cited audit reports; implement the navigation and form using the existing roster and run API.
- [x] Read-test scoped run progress and finding pages; show daily minutes, evidence limitations, findings with reasons and available decisions, and weekly themes/open items/citations. Keep approved records read-only except existing explicit reopen.
- [x] In Agent OS remove the standalone navigation and screens, redirect old audit links to Payroll and old activity links to Insights; keep shared provider integrations intact.
- [ ] Verify focused, type, full suite, builds, review, and rendered wide/narrow flows before merge or deploy.

## Checkpoint

- Work OS base `6f8fbf64`; Agent OS base `baa177fd`. Both worktrees use
  `codex/payroll-audits`. No production writes.
- Focused read/UI, payroll-hours, and legacy redirect checks passed. Local
  Chromium rendered the actual React components against synthetic API
  responses at 1440px and 390px, including the New audit → queued result
  and the finding-decision flow. Screenshots are under
  `/tmp/opencode/payroll-audits-fixture/`.
- `npm run work-os:test` finished with 1,585 passed, zero failures and
  16 opt-in skips across its four batches. Work OS typecheck and production
  Webpack build passed; the Agent OS build is pending.
- Ruling: give aggregate findings date-scoped keys because separate days
  otherwise overwrite one another in the review revision. Existing persisted
  reviews need a new analysis to see the corrected set.
- CodeRabbit reviewed four questions: the existing review API already requires
  enabled payroll; the schema makes review expiry non-null; reopening clears
  `current_approval_id`; finding decisions use the stable finding key, not
  the row UUID. None requires an additional behavior change.
- No matching Payroll TestSprite test was found. Proposed scenario for approval:
  start on a synthetic default Records view, open New audit, select the fixture
  employee, submit, and verify that the matching audit is queued without an
  approval.
