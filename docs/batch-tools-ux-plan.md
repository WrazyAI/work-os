# Batch task tools — UX/behaviour fixes plan

Status: approved, ready to implement
Scope: the grouped batch approval card in the Work OS companion (in-app chat + floating
companion). Server-side additions are limited to status-label resolution.

## 1. Problem

The batch tools (`multi_task_add`, `multi_task_edit`, `multi_task_archive`,
`multi_task_delete`, `multi_task_log`, `multi_task_reassign`, `plan_import`) file
correctly, but their cards are **static**: once a decision is made the card keeps
looking like it is still awaiting one. Reported symptoms:

- The **Approve/Skip buttons stay active after the batch was approved**, so the same
  card can be clicked again and appears able to re-file the same work.
- A **skipped** batch is rendered as if it had been approved, with no per-item state.
- Cards do not settle: nothing collapses after a decision, and interaction is not
  blocked once the outcome is known.
- There are **no change-type indicators** — a new task, an edit, and a status move all
  look the same on the card.

## 2. Root causes (verified in code)

### 2.1 Results are matched by object identity
`desktop/work-os-companion/src/TaskBatchCard.tsx` (`BatchApprovalCards`):

```ts
const result = results.find((item) => item.op === op);
```

The card approves a **copy** — `onApprove({ ...operation, tasks: draft })` — and the
hosts then re-map operations to new objects too (`App.tsx` sets `enabled: false` with
`{ ...op }`). After filing, the identity lookup misses, so `filed` is false and the
approve footer renders again. The same break makes a **reloaded** history turn look
un-approved even though `toolResults` was persisted.

`toolCallKey` already exists for exactly this problem, but batch operations never
receive a `proposalId`, so the key falls back to `op|taskId|statement` — stable across
a copy, but not exact (`taskId` is undefined for a batch, so two batches with the same
statement collide).

### 2.2 Skipped batches lose their state and are mislabelled
`desktop/work-os-companion/src/interpretation.ts`, reject branch of
`fileApprovedOperations`:

```ts
if (options?.decision === "reject") {
  await transport.reviewBatch(batchId, { decision: "reject", decisions: [] });
  outcome.results.push({ op, status: "denied", message: "Skipped. Nothing from this batch was recorded." });
  continue;
}
```

- No `data` is returned, so per-entry outcomes disappear.
- The card computes `filed = !!result && result.status !== "failed"`, which treats
  `status: "denied"` as filed — the hint then literally reads *"Approved. Each item
  reports its own result below."* for a skipped batch.
- `outcomeFor` has no case for the server's `rejected` / `stale` statuses, so entries
  fall through to a meaningless "Pending".

### 2.3 Nothing settles
`collapseWhenInactive` only sets the **initial** expanded state and is only passed for
non-latest turns. After a decision the live card stays fully expanded, and the pencil is
hidden only for `filed`/`failed`, not for skipped.

### 2.4 No change-type indicators
Only a generic `Existing task` chip exists. There is no `NEW` / `EDIT` / status pill.

### 2.5 No status labels on the client
`interpretationTaskOptions()` returns only `{ id, title }`, and there is no
column-id → name mapping anywhere in the client. The server has the raw material:
`listPersonTasks` rows carry both `task_group_id` and `status`, where `status` is the
human name (`normalizeNiftyTask` reads `namedValue(item.status …)`).

## 3. Decisions (agreed)

1. **Skipped** batches collapse to a muted accordion ("Skipped · N changes · nothing was
   filed"), expandable read-only, with the Skip button replaced by a `Skipped`
   indicator; interaction blocked.
2. **Status names** are resolved by the server and shown as real names; if a name cannot
   be resolved the pill is **omitted** rather than showing a raw column id.
3. Settled cards **auto-collapse immediately**, including in the newest turn.
4. **All seven batch tools** share one pill vocabulary.

## 4. Design

### 4.1 Stable result matching
- Extend `toolCallKey` to prefer `batchId`:
  `op.proposalId ?? op.batchId ?? `${op.op}|${op.taskId ?? ""}|${op.statement}``.
- `BatchApprovalCards` resolves its result by `toolCallKey(item.op) === toolCallKey(op)`.
- This also makes `mergeToolResults` key batches exactly, so two batches can no longer
  collide.

### 4.2 Card state machine
One explicit state derived from the result:

```
review ──arm──> confirm ──file──> filing ──┬──> approved
                                           ├──> skipped
                                           └──> failed
```

| State | Presentation | Actions |
|---|---|---|
| `review` | expanded entries, pencil available, two-step footer | Skip · Approve all N |
| `confirm` | same, armed | Back · Confirm N |
| `filing` | busy, buttons disabled | — |
| `approved` | **auto-collapsed accordion**, summary `N filed`, read-only when expanded, per-entry outcome pills | none |
| `skipped` | **auto-collapsed accordion**, muted, summary `Skipped · N changes · nothing was filed` | none (Skip shows as `Skipped`) |
| `failed` | expanded, error message | Retry · Skip |

Rules:
- Approved/skipped collapse regardless of turn age; the accordion toggle stays
  interactive so results can be read.
- No pencil, no approve, no skip once settled.
- The rejected path returns `data: { batch: response }` so per-entry `Skipped` states are
  available.
- `outcomeFor` gains `rejected` and `stale` → muted "Skipped" tone.

### 4.3 Change-type pills
Rendered next to the entry title; computed from the **current draft** (so clearing a
status shows "Status unchanged", not a stale pill).

| Change | Pill |
|---|---|
| New task (add batch, no `taskId`) | `NEW` |
| New step (any subtask) | `NEW` |
| Wording edit (title/description) | `EDIT` |
| Status move | `OLD_STATUS → NEW_STATUS` (two pills + arrow) |
| Completion | `DONE` / `REOPEN` |
| Archive / delete | `ARCHIVE` / `DELETE` |
| Progress note | `LOG` |
| Reassignment | `REASSIGN` |

`Existing task` becomes the fallback chip only when no semantic pill applies.

### 4.4 Status label resolution
- **Interpret route** (`src/app/api/work-os/me/interpret/route.ts`): build a
  `column id → human name` map from the already-loaded task rows (no extra query) and
  annotate each batch entry with `fromStatus` (the target task's current status) and
  `toStatus` (the target column's name).
- **Filing** (`src/lib/work-os-proposals.ts`): persist `from_status` / `to_status` in
  `proposed_change` so the filed row is self-describing.
- **Client** (`attachFiledProposals`): re-attach the labels from the filed row, using the
  same pattern already used to backfill a missing `title` from `before_state`. Filed and
  reloaded cards then match the live card.
- Unknown label → omit the pill. Caveat: the new name is derived from a task already in
  that column, so if Nifty reports a normalised value (`open`/`completed`) we show that
  rather than invent a label.

### 4.5 Presentation
`desktop/work-os-companion/src/workspace-redesign.css`: pill family, status arrow,
muted skipped tone, settled accordion head/chevron/body — reusing the `ApprovalResults`
visual language so the two read as one system, and honouring reduced motion and the
compact breakpoint.

## 5. Implementation phases

1. **Settle + matching** (fixes the reported bugs): `toolCallKey`, keyed lookup, reject
   `data`, `outcomeFor` statuses, state machine, auto-collapse. Tests first for the
   re-approve regression.
2. **Pills**: vocabulary + rendering from the draft; CSS.
3. **Status names**: interpret annotation, `proposed_change` persistence, client
   re-attachment.
4. **Docs + verification + release**: `design.md` §25.10.2, suites, browser checks,
   redeploy, live probe.

## 6. Files

- `desktop/work-os-companion/src/TaskBatchCard.tsx` — state machine, keyed lookup, pills,
  settle/collapse.
- `desktop/work-os-companion/src/interpretation.ts` — `toolCallKey`, reject `data`,
  `outcomeFor`, label fields, `attachFiledProposals` re-attachment.
- `desktop/work-os-companion/src/workspace-redesign.css` — pill/settled/accordion styles.
- `src/lib/aiInterpret.ts` — batch entry label fields.
- `src/app/api/work-os/me/interpret/route.ts` — status-label map + annotation.
- `src/lib/work-os-proposals.ts` — persist `from_status` / `to_status`.
- `design.md` §25.10.2 — settled-state contract and pill vocabulary.

No database migration is required.

## 7. Verification

- **Unit (companion, vitest)**: re-approve regression (approve a copy → card settled, no
  buttons); skipped accordion + blocked interaction; keyed matching across copied and
  reloaded operations; every pill type; label fallback omits unknown names.
- **Node**: status-label wiring and `from_status`/`to_status` persistence.
- **Browser** (`?preview-chat&isolate=batch`): approve → collapsed accordion with no
  buttons; skip → `Skipped` and blocked; settled-after-reload; each pill; 520px and
  reduced-motion.
- **Live**: redeploy, then a batch probe that files and rejects a batch and confirms the
  card-level and per-item outcomes.

## 8. Out of scope

- Adding or removing entries while reviewing a batch.
- Per-entry removal in the approval payload (still requires a new batch tool).
- A batch undo/rollback beyond the existing per-item Retry.
