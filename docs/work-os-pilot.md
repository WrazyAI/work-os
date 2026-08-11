# Work OS pilot checklist

The Work OS web pilot is organization-scoped. Nifty remains authoritative for task state; Worktivity activity and screenshots are supporting evidence only. AI check-ins produce reviewable proposals and never write provider changes without an employee decision.

## Readiness sequence

1. Apply migrations `0008_work_os.sql` through `0011_work_os_employee_onboarding.sql`.
2. Enable `employee_companion` for the organization.
3. Add active employee and manager memberships, map each employee to a Work OS person, role profile, team, manager, Nifty member, Worktivity employee, and current schedule.
4. Connect Nifty and verify credentials. Add GitHub/GHL connections and verified, non-shared source accounts only when those features are enabled.
5. Populate open-task metadata: assignee, due date, priority, estimated effort, expected outcome, definition of done, and Nifty task group.
6. Configure runtime secrets required by the enabled features.
7. Run the read-only audit before inviting pilot employees:

```bash
npm run work-os:pilot-audit -- --strict
```

The audit requires either `SUPABASE_DB_URL` or `SUPABASE_DB_PASSWORD` plus `NEXT_PUBLIC_SUPABASE_URL`. It prints configuration gaps and never prints provider tokens.

## Employee flow

The employee completes onboarding and purpose-limited tracking consent, confirms a schedule proposal, and may opt into neutral screenshot summaries. Sensitive app/domain exclusions are merged with organization policy. Consent can later be withdrawn from the onboarding endpoint; withdrawal stops future processing and is audited.

During the shift, My Day shows Nifty tasks, shift-aware prompts, Worktivity evidence, and pending AI proposals. Accepting a proposal performs an idempotent, auditable Nifty write-through. Provider outages become visible failures and can be retried; task changes mark a proposal stale rather than applying an old plan.

At EOD, the employee drafts, edits, and submits a report. The submitted markdown is preserved as an immutable employee snapshot. A manager can review only reports for their own team, edit a manager version, and approve or reject the report. Rejected reports can be edited and resubmitted.

## Privacy and evidence rules

- Activity is not completion evidence. Output evidence, work claims, and activity observations remain distinct.
- GitHub and GHL events are unattributed unless the source identity is verified, mapped to an active organization person, and not marked shared or ambiguous.
- Screenshot bytes are AES-256-GCM encrypted in a private bucket, never exposed through public storage URLs, gated by a reason and review flag for non-owner access, and scheduled for deletion after 30 days.
- Replays use `Idempotency-Key` on check-ins, proposals, evidence, and report transitions where supported.
- RLS policies and every server-side query carry organization/person/team scope; provider credentials are admin-only.

## Validation

```bash
npm run work-os:typecheck
npm run work-os:test
```

`work-os:test` covers migration reapplication, RLS isolation, idempotency constraints, provider attribution/webhooks, readiness, route contracts, schedule validation, and screenshot encryption/policy. The repository-wide Next build still requires the unrelated parent-app and SEO modules/assets that are not present in this partial local Work OS checkout. Desktop source is intentionally outside this web-pilot thread.
