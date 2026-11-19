# Administration evidence and integrations

**Use when:** Changing evidence records, restricted screenshots, provider connections, or account mapping.

**Owns:** Provider provenance, integration state, and the audited evidence record.

**Requires:** [Shared foundations](../foundations.md); [Administration shell and shared contracts](shell.md) (read each once per task).

**Read next only if:**

- Changing employee-attached completion evidence: [Task drawers and completion evidence](../patterns/task-details.md).
- Changing activity recap evidence: [Activity interval reviews](../areas/recaps.md).

**Implementation starting points:** [EvidencePage.tsx](../../../desktop/work-os-companion/src/admin/EvidencePage.tsx).

## Evidence record

**Evidence** separates evidence from activity recaps, filters by date range,
person, source, and disputed state, and groups rows by day. The record opens
with a labeled volume chart and a bounded list (first 60 items, then Show
more). The detail drawer exposes provenance and, for flagged or disputed items
only, restricted screenshot access with a recorded reason and audit entry.

## Evidence integrations

Provider integrations surface as one band at the top of the Evidence page: a
live provider card (connection state, workspace, mapped accounts, last event,
and the repository-management action) beside future providers rendered as a
quiet disabled card with a `Coming soon` pill and no controls — never a blurred
mock. Unmapped provider accounts appear as
a queue — account, event count, last activity, a person selector seeded from
the employee's own provider username — with one `Map & backfill` action that
verifies the account and attributes its earlier events. Accounts whose login
ends in `[bot]` (or names a known automation actor) are automation, not people:
they are summarised on one line with their event count and never offered a
person selector, because mapping one would attribute machine work to a teammate.
A repository drawer
lists the organization's repositories with their webhook state; without a
repository-management token it shows the manual setup instead. Provider tokens
and webhook secrets never reach the client. Ingested GitHub events are default
branch pushes, pull-request open/close, submitted reviews, completed workflow
runs, deployment status changes, and issue open/close; every event carries its
repository and actor so a row can always name where it came from.

## Employee visibility is a separate contract

The [employee Evidence visibility exception](../../design-exceptions.md)
applies to the companion's dedicated employee Evidence destination. Keep this administration record's existing
role, organization, restricted-image, and audit boundaries.
