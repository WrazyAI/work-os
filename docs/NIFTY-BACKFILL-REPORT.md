# Nifty Backfill Verification Report

**Date:** 2026-09-14
**Method:** One final full `syncNifty` run, then a SQL-vs-API reconciliation
(`scripts/verify-nifty-backfill.mts` on the VPS), a live server-side approval
round-trip (`scripts/verify-approval-roundtrip.mts`), and a TestSprite end-to-end
test against the deployed app (`cf39d0ee`, 12/12 passed).
**Related:** `docs/NIFTY-EXIT-PLAN.md` Phase B, Nifty ledger `sFgUhkIiFF`.

---

## 1. Result: backfill verified

**Every Nifty-backed row the employee surfaces can render exists in Neon, with
matching field values.**

| Check | Result |
|---|---|
| Field parity (name, completed, due date) vs Nifty API | **0 mismatches across 1,459 compared rows** |
| Assignee identifier domain (`assignee_person_ids` → `work_people.id`, same `user_id`) | **0 gaps** |
| Full sync duration | ran as Phase B step 1 before comparison |
| Neon mirror size | 1,602 tasks (100% with `provider_task_id`), 1,284 with due dates, 101 subtasks |

### Mirror rows Nifty no longer returns: 140

| State | Count |
|---|---:|
| completed | 62 |
| open | 44 |
| archived | 34 |

These are rows the mirror captured historically that Nifty's task-list API no
longer returns (Nifty-side deletions/archivals since capture). For the migration
this is the desired shape: **Neon is the superset record** — the Work OS surfaces
can keep rendering this history after the Nifty dependency is removed, which
raw Nifty reads could not.

## 2. Deployed approval functionality (live, server-side)

`scripts/verify-approval-roundtrip.mts` exercised the real deployed code paths
with a scratch task (created, completed through the immutable proposal gate,
then archived to leave nothing behind):

| Step | Before fix | Verified now |
|---|---|---|
| Create task | — | 2.26 s |
| **Proposal acceptance (`reviewWorkOsProposal`)** | **2 m 07 s (blocked by full org sync; client aborted at 60 s)** | **1.13 s — `applied`** |
| Completion persisted in Neon | 0 applied all-time | `completed=true`, `completed_at` recorded |
| Archive cleanup | — | 0.45 s |

## 3. Deployed UI verification (TestSprite)

| Test | Target | Result |
|---|---|---|
| Approval results report slow responses truthfully and offer navigation | companion preview | 17/17 passed |
| Unfiled approval offers a retry control | companion preview | 5/5 passed |
| **Live app: backfilled tasks render and pending reviews surface** | https://app.wrazyos.com | **12/12 passed** |

The live run signed in with a temporary verification account, opened the Work OS
workspace, confirmed real backfilled task data renders (including the task
created through the approval pipeline: "Integrate CodeRabbit and TestSprite
into Work OS"), and confirmed no error states. The account was deleted
immediately after the run (verified: 0 auth user / account / session / profile /
membership rows remain).

## 4. Known caveats

- The 44 "open" mirror rows absent from Nifty's list are most plausibly
  tasks deleted directly in Nifty outside the Work OS flow after capture. They
  remain visible in Neon; before Phase D cutover, Phase B's follow-up should
  reconcile them against Nifty's tombstone state.
- `syncNifty` becomes a manual import/reconciliation tool only after cutover
  (Phase D); this run used it as the final full sync.
- The Nifty OAuth refresh token on the server is invalid (`invalid_grant`) and
  every provider call degrades to the configured access token. Working today,
  but it is another reason to complete the Nifty exit before the access token
  itself expires.
