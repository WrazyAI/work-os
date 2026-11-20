# Evidence Hybrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop Administration → Evidence page with the approved Record / Coverage hybrid, keeping the provider occurrence time and actor/assignee/automation split truthful.

**Architecture:** A shared pure classifier names evidence kinds for the API summary and the desktop. The evidence route adds kind counts, a people count, search, an unattributed filter, and a bounded 14-day coverage aggregate. The desktop page keeps one `EvidencePage` orchestrator, with focused `EvidenceRecordView`, `EvidenceCoverageView`, and `EvidenceDetailDrawer` components and a pure `evidenceModel` for grouping/labels.

**Tech Stack:** Next.js route handler, PostgreSQL/Supabase query shim, React 19 + TanStack Query, Vitest, `node:test` route contracts.

**Spec:** `docs/superpowers/specs/2026-11-20-evidence-hybrid-design.md`

**Status (2026-11-20):** Tasks 1–6 are implemented on `codex/evidence-hybrid`. The companion suite passes (2,075 tests), root typecheck passes, and the rendered Record/Coverage views were checked at 1440, 1024, 720, and 390 in light and dark, including the email filter, group expansion, drawer, Unattributed deep link, and Connections/repos drawers. The full Work OS suite and CodeRabbit are finishing; no version bump or release is part of this branch.

## Global Constraints

- Use Work OS tokens; no new gradients, card grids, or signal-filled tabs.
- Render at 1440, 1024, 720, and 390 in light and dark.
- Provider occurrence time (`recorded_at`) is the ordering and display time; `created_at` is the mirror.
- Never credit automation, shared accounts, or an assignee as the actor.
- The API page limit is 500. The ledger may be partial; the UI must say so instead of implying it is complete.
- Preserve Activity recaps, GitHub repository management, screenshot access, and the existing query-refresh contract.

## Review Focus

- A busy day with 101 calls and one email: the email must remain independently visible and reachable.
- A coverage cell with only uncredited events: `Open in Record` must land on a truthful Unattributed ledger, not all people.
- A partial ledger (more than 500 rows): counts and foot copy must disclose the loaded subset.
- A disputed inbound call: the drawer must keep the actor unknown and show the correction state.
- A 720px view: the toggle, filters, and matrix must not collide or hide the only email row.

---

### Task 1: Shared evidence kind classifier

**Files:**
- Create: `src/modules/work-os/evidence-kinds.ts`
- Test: `test/work-os-evidence-kinds.test.mts`

**Interfaces:**
- Produces:
  - `type EvidenceKind = "call" | "email" | "text" | "context" | "github" | "worktivity" | "other"`
  - `type EvidenceKindBucket = "calls" | "emails" | "texts" | "work" | "context"`
  - `evidenceKind(source: string, title: string): EvidenceKind`
  - `evidenceKindBucket(kind: EvidenceKind): EvidenceKindBucket`
  - `evidenceKindLabel(kind: EvidenceKind): string`

- [ ] **Step 1: Write the failing test**

Assert:
- `evidenceKind("ghl", "Call outbound") === "call"`
- `evidenceKind("ghl", "Email sent") === "email"`
- `evidenceKind("ghl", "Text message sent") === "text"`
- `evidenceKind("ghl", "Opportunity open") === "context"`
- `evidenceKind("github", "Pull request merged") === "github"`
- `evidenceKind("worktivity", "Observed review block") === "worktivity"`
- `evidenceKind("ghl", "Something else") === "other"`
- `evidenceKindBucket("github") === "work"`, `evidenceKindBucket("other") === "context"`.
- Case and whitespace remain stable.

- [ ] **Step 2: Run it and see it fail**

Run: `node --import tsx --test test/work-os-evidence-kinds.test.mts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure classifier**

Trim and lowercase the title; match prefixes/includes in this order: GitHub/Worktivity source, GHL call, email, text, opportunity. Return `other` otherwise. Keep the module free of React, database, and Node imports.

- [ ] **Step 4: Run it and see it pass**

Run: `node --import tsx --test test/work-os-evidence-kinds.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/work-os/evidence-kinds.ts test/work-os-evidence-kinds.test.mts
git commit -m "feat(work-os): classify evidence kinds"
```

---

### Task 2: Summary, search, unattributed filter, coverage

**Files:**
- Modify: `src/app/api/work-os/evidence/route.ts`
- Test: `test/work-os-route-contracts.test.mts`

**Interfaces:**
- Consumes: `evidenceKind` from Task 1.
- Produces on `summary`:
  - `kinds: Array<{ kind: EvidenceKind; count: number }>`
  - `peopleCount: number`
  - `coverage?: { people: Array<{ personId: string | null; days: Array<{ date: string; count: number; emails: number }> }> }`
- Accepts `q` (title/summary search), `unattributed=1` (person_id is null), and `coverage=1`.

- [ ] **Step 1: Add the failing route contract assertions**

In `test/work-os-route-contracts.test.mts`, assert the route source contains `summary.kinds`, `peopleCount`, `coverage`, `unattributed`, and a `q` filter. Keep the existing summary assertions.

- [ ] **Step 2: Run the contract test**

Run: `node --import tsx --test test/work-os-route-contracts.test.mts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement the route changes**

- Add `q` to the main query, GHL context query, and summary query via `.or("title.ilike.%term%,summary.ilike.%term%")` with `%`, `,`, and parentheses stripped from the term.
- Add `unattributed=1`: skip the person-id `in` filter and apply `.is("person_id", null)` to the evidence and summary queries. Keep GHL context included.
- Add `title` and `person_id` to the summary select. Count `kinds`, distinct non-null people, and (when `coverage=1`) per-person/day counts and email counts.
- Replace the GHL context head-count with a bounded `occurred_at,title` read that contributes source, day, kind, and uncredited coverage counts.
- Return `kinds`, `peopleCount`, and `coverage` only from the `summary=1` branch. Cap coverage reads at 5,000 rows.

- [ ] **Step 4: Run the contract test and typecheck**

Run: `node --import tsx --test test/work-os-route-contracts.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/work-os/evidence/route.ts test/work-os-route-contracts.test.mts
git commit -m "feat(work-os): summarize evidence kinds and coverage"
```

---

### Task 3: Desktop summary types and normalization

**Files:**
- Modify: `desktop/work-os-companion/src/admin/types.ts`
- Modify: `desktop/work-os-companion/src/admin/data.ts`
- Test: `desktop/work-os-companion/src/admin/evidenceData.test.ts`

**Interfaces:**
- Produces: `EvidenceSummary` with `kinds`, `peopleCount`, and `coverage`; `normalizeEvidence` preserves them.
- `EvidenceRow.recorded_at` already exists; do not change it.

- [ ] **Step 1: Write the failing normalization test**

Build a raw payload with `summary.kinds`, `summary.peopleCount`, and `summary.coverage`, then assert `normalizeEvidence` keeps the counts and the null `personId` coverage row.

- [ ] **Step 2: Run it and see it fail**

Run: `cd desktop/work-os-companion && npx vitest run src/admin/evidenceData.test.ts`
Expected: FAIL because the summary type/normalizer drops the fields.

- [ ] **Step 3: Implement the types and normalizer**

Add the fields to `EvidenceResponse["summary"]`; normalize them with `asRows`/`asNumber`/`asTextOrNull`. Preserve `coverage` only when present.

- [ ] **Step 4: Run it and see it pass**

Run: `cd desktop/work-os-companion && npx vitest run src/admin/evidenceData.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/admin/types.ts desktop/work-os-companion/src/admin/data.ts desktop/work-os-companion/src/admin/evidenceData.test.ts
git commit -m "feat(companion): normalize evidence summary and coverage"
```

---

### Task 4: Evidence model and grouping

**Files:**
- Create: `desktop/work-os-companion/src/admin/evidenceModel.ts`
- Test: `desktop/work-os-companion/src/admin/evidenceModel.test.ts`

**Interfaces:**
- Consumes: `EvidenceRow`, `evidenceKind`, `evidenceKindBucket`.
- Produces:
  - `evidenceOccurrence(row): string`
  - `evidenceTime(row): string`
  - `evidenceDirection(row): "inbound" | "outbound" | null`
  - `evidenceStatus(row): { label: string; tone: "observed" | "quiet" | "warn" | "danger" }`
  - `evidenceDuration(row): string | null`
  - `evidencePerson(row): { name: string; note: string; tone: "actor" | "context" | "unknown" }`
  - `evidenceActor(row): string`
  - `evidenceAssignee(row): string | null`
  - `evidenceAutomation(row): boolean`
  - `groupEvidenceEntries(rows): Array<{ type: "group"; key; hour; direction; rows } | { type: "event"; row }>`
  - `groupEvidenceDays(rows): Array<{ date: string; rows: EvidenceRow[] }>`
  - `buildCoverageRows(summary, people, dates): CoverageRow[]`
  - `coverageLevel(count): 0 | 1 | 2 | 3 | 4`

- [ ] **Step 1: Write failing tests**

Test:
- 13 outbound calls in the 9 AM hour become one group with 13 rows.
- An email at 13:05 sorts after the 13:00 group, not inside it.
- `recorded_at` wins over `created_at` for time and ordering.
- An inbound call with no person returns `Actor unknown`, not the assigned owner.
- An assigned-only row returns the assignee as context and the actor as unknown.
- Automation returns `Automation` and `automation: true`.
- Coverage maps a null person to `Not employee work` and counts email cells.

- [ ] **Step 2: Run it and see it fail**

Run: `cd desktop/work-os-companion && npx vitest run src/admin/evidenceModel.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the model**

Keep it pure and local. Use `formatWorkOsFullDate` only in components; the model returns ISO dates and raw labels. Parse status/direction/duration defensively; invalid values become `Recorded`/`—`.

- [ ] **Step 4: Run it and see it pass**

Run: `cd desktop/work-os-companion && npx vitest run src/admin/evidenceModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/admin/evidenceModel.ts desktop/work-os-companion/src/admin/evidenceModel.test.ts
git commit -m "feat(companion): model evidence grouping and attribution"
```

---

### Task 5: Record view and detail drawer

**Files:**
- Create: `desktop/work-os-companion/src/admin/EvidenceRecordView.tsx`
- Create: `desktop/work-os-companion/src/admin/EvidenceDetailDrawer.tsx`
- Create: `desktop/work-os-companion/src/admin/evidence-hybrid.css`
- Modify: `desktop/work-os-companion/src/admin/EvidencePage.tsx`
- Modify: `desktop/work-os-companion/src/admin/adminFixtures.ts`

**Interfaces:**
- Consumes: model from Task 4; summary from Task 3; existing `people`, `evidence`, `intervals`, `connections`, `githubActors`, `githubRepos` queries.
- `EvidencePage` owns the queries, filters, selected row, view mode (`record | coverage`), record mode (`evidence | recaps`), and drawers.

- [ ] **Step 1: Build the Record surface**

Replace the four top cards with:
- a view bar (Record/Coverage toggle, date inputs, Connections button, Activity recaps link);
- the index band (records, calls, emails, people, scope);
- the 14-day pulse;
- the query bar (search, person, source, kind chips, disputed);
- the grouped ledger (day headers, hour groups, individual email rows, expansion, "Show older"/partial disclosure);
- an empty state with Clear filters;
- a detail drawer with Actor/Assigned/Automation and Occurred/Mirrored.

Keep the existing screenshot access rule and the existing activity-recap list behind the secondary `Activity recaps` view.

- [ ] **Step 2: Move integrations into a Connections drawer**

Move the GitHub connection facts, mapped accounts, unmapped actors, receipt, and `Manage repositories` into a drawer. Keep the repositories drawer. Show a warning dot on the Connections button when unmapped actors exist.

- [ ] **Step 3: Keep the query keys refreshable**

All new evidence/pulse/coverage reads use `adminKeys.evidence(...)` so `adminSectionQueryMatches("evidence", …)` and the masthead refresh cover them. Set the Record limit to 500.

- [ ] **Step 4: Update the rendered fixtures**

Seed the new filter keys (`limit: "500"`, `q`, `unattributed`, `coverage`, pulse) and add realistic GHL calls + one email + an uncredited row so `?preview-admin&section=evidence` exercises the hybrid. Keep the empty/sparse states honest.

- [ ] **Step 5: Verify**

Run:
```bash
cd desktop/work-os-companion
npx tsc --noEmit
npx vitest run src/admin/evidenceModel.test.ts src/admin/evidenceData.test.ts
npx vite build
```
Expected: all pass. Render `?preview-admin&section=evidence` at 1440 and 720 in light/dark and confirm the email row, the drawer, and the recaps view.

- [ ] **Step 6: Commit**

```bash
git add desktop/work-os-companion/src/admin/EvidenceRecordView.tsx desktop/work-os-companion/src/admin/EvidenceDetailDrawer.tsx desktop/work-os-companion/src/admin/evidence-hybrid.css desktop/work-os-companion/src/admin/EvidencePage.tsx desktop/work-os-companion/src/admin/adminFixtures.ts
git commit -m "feat(companion): rebuild the Evidence record view"
```

---

### Task 6: Coverage view and Open in Record

**Files:**
- Create: `desktop/work-os-companion/src/admin/EvidenceCoverageView.tsx`
- Modify: `desktop/work-os-companion/src/admin/EvidencePage.tsx`
- Modify: `desktop/work-os-companion/src/admin/evidence-hybrid.css`
- Test: `desktop/work-os-companion/src/admin/EvidencePage.render.test.ts` (add a static render assertion for the toggle and coverage rows)

**Interfaces:**
- Consumes: `summary.coverage` from Task 3; `buildCoverageRows` from Task 4.
- Produces: `EvidenceCoverageView` with `selected`, `onSelect`, `drillRows`, `onOpenRecord`.

- [ ] **Step 1: Add the Coverage surface**

Render the 14-day matrix, legend, `Not employee work` row, email markers, daily totals, and the drill-down ledger. Selecting a cell fetches its drill rows; selecting `Open in Record` sets Record's person/day/source and switches the top toggle.

- [ ] **Step 2: Add the coverage query and drill**

Fetch the coverage summary with `coverage=1&summary=1&limit=1` for the last 14 days. Fetch the selected cell with `limit=500&summary=1` and the person/date, or filter `!person` for `Not employee work`.

- [ ] **Step 3: Preserve the Record filters**

Switching to Coverage does not reset the Record person/source/kind/date/search/disputed state. `Open in Record` deliberately replaces person/date/source with the selected cell.

- [ ] **Step 4: Verify**

Run the companion typecheck, focused Vitest, and Vite build. Render Coverage at 1440, 1024, and 720 light/dark; check `Open in Record` for a person cell and the `Not employee work` cell.

- [ ] **Step 5: Commit**

```bash
git add desktop/work-os-companion/src/admin/EvidenceCoverageView.tsx desktop/work-os-companion/src/admin/EvidencePage.tsx desktop/work-os-companion/src/admin/evidence-hybrid.css desktop/work-os-companion/src/admin/EvidencePage.render.test.ts
git commit -m "feat(companion): add Evidence coverage view"
```

---

### Task 7: Full verification and branch review

- [ ] Run `npm run work-os:typecheck`.
- [ ] Run the focused desktop Vitest suites.
- [ ] Run `npm run work-os:test` (about 13 minutes).
- [ ] Run CodeRabbit once on the completed branch.
- [ ] Verify the rendered page at 1440/1024/720/390 in light/dark, including the email row, a call group expansion, the drawer, disputed state, the Coverage cell, and Open in Record.
- [ ] Append the companion release-queue outcome only after verification; do not change versions or publish as part of this branch.
