# Work OS Companion Payroll Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. Track the steps below against ledger task `10a4f74e-df08-4dce-b71b-7d3014397be2`.

**Goal:** Let Work OS administrators open and run Payroll audits from the installed Companion, without giving employees a payroll surface or maintaining a second payroll system.

**Architecture:** The Companion renders native React views in its existing administration shell. It uses the existing workspace-bound desktop session and Work OS payroll APIs; the server remains authoritative for permissions, analysis, decisions, receipts, and retention.

**Tech stack:** Tauri Companion, React, TanStack Query, Vitest, existing Work OS payroll API.

**Spec:** The installed version of the workflow in `docs/design/admin/payroll.md` and the existing payroll guarantees in `docs/superpowers/specs/2026-11-16-work-os-payroll-review-design.md`. Native implementation does not affect the separate Agent OS web deployment.

## Global constraints

- Admin mode only: no employee/manager navigation, data requests, or access. Do not introduce new Tauri commands, a new session channel, a provider client, or a persistent payroll cache.
- Payroll starts on **Records**. **Audits** and **New audit** use the same reviewed records and eligible mapped employees as the web. Starting an audit never approves hours.
- A new organization, session, or role must not momentarily render another workspace's payroll data. Use the workspace identifier in query keys and verify it on the transport; rely on server authorization on every request.
- Keep approvals explicit, use revision tokens and recorded reasons, and preserve the server's guarded screenshot policy. No new direct screenshot access.
- No installer build or release outside the repository's release cadence.

## Review focus

- Employee mode or a stale workspace session cannot read a prior admin query cache.
- Disabled payroll, an empty period, and a failed audit have distinct states.
- A late response or retry to start an audit cannot target the wrong employee or duplicate a run.
- Approval and finding controls never appear for an old analysis revision or an already-approved receipt.
- Native navigation works at narrow widths with keyboard focus; use the shared shell rather than adding a second webview or top bar.

### Task 1: Add a native admin destination and read Payroll

- [x] In `desktop/work-os-companion/src/admin/AdminWorkspace.render.test.ts`, add a Payroll selection test that renders a native Payroll child for an administrator; in the sidebar render tests assert it never appears in employee navigation. Run both; confirm the missing destination fails.
- [x] Add the section to `desktop/work-os-companion/src/admin/types.ts`, `AdminWorkspace.tsx`, `adminRefresh.ts`, `desktop/work-os-companion/src/SidebarNav.tsx`, and `App.tsx`. Handle the deliberate absence of a dedicated guide in `guideState.ts` without borrowing another section's labels.
- [x] Add `desktop/work-os-companion/src/admin/payroll/api.ts`: organization-keyed roster/review/day/finding queries using `apiRequest` from `desktop/work-os-companion/src/api.ts`. Consume type-only payroll contracts from `src/modules/work-os/payroll/contracts.ts`.
- [x] Add `desktop/work-os-companion/src/admin/payroll/PayrollPage.tsx` with default Records, Audits, pay-date selection, bounded pages, and the existing desktop admin controls. Verify empty, disabled and network-error states independently.

### Task 2: Run and review audits natively

- [x] Test that a selected mapped person and pay date issue one stable request key across retries, the response opens the exact review, and busy/audit status never renders as approval.
- [x] Implement New audit in `desktop/work-os-companion/src/admin/payroll/PayrollPage.tsx` and audit content in `PayrollAuditDetail.tsx` in the same directory. Render daily evidence, weekly citations and limitations, and paged findings. Bind every decision and approval to the current server revision; add separate confirmation for approval and use the frozen receipt flow for approved records.
- [x] Render focused fresh/stale/running/approved state tests and verify no direct Worktivity or raw screenshot calls from the native page.

### Task 3: Verify the installed experience

- [x] Add deterministic companion AdminPreview fixtures in `desktop/work-os-companion/src/admin/AdminPreview.tsx`; verify wide/compact/narrow, light/dark, keyboard/focus, loading/error and reduced motion in the actual companion renderer.
- [x] Run companion Vitest and build, Work OS typecheck and full suite; verify current desktop bearer/CORS/auth behavior for payroll endpoints and ensure admin payroll cache is excluded from device persistence.
- [x] Record checks and release eligibility. Keep native packaging independent of the already-authorized Agent OS web rollout.

## Design checkpoint

The admin masthead names Payroll once. Start on the period and its records, not a second summary dashboard. Use the existing admin form fields, segmented controls, ledger tables, warm paper and ink tokens, and tabular numbers. Reserve the signal color for the section's next action. A record opens its native detail in the same stage; no duplicate sidebar or window. At narrower widths preserve all values in a horizontally scrollable table and stack the toolbar. No new font, palette, or entrance motion.
