# Data truth, async states, and pagination

**Use when:** Changing displayed facts, provenance, dates, async states, or growing lists.

**Owns:** Evidence classes, truthful state labels, date formatting, and the default list contract.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing employee task pagination: [Employee task workspace and finder](../areas/tasks.md).
- Changing recap pagination: [Activity interval reviews](../areas/recaps.md).
- Changing memory pagination: [Work Memory](../areas/memory.md).
- Changing admin task dates or paging: [Administration task record](../admin/tasks.md).

**Implementation starting points:** [useEmployeeDay.ts](../../../src/modules/work-os/employee/useEmployeeDay.ts).

## Data truth and provenance

The visual system must keep these evidence classes distinct:

- Work OS session state.
- Worktivity provider state and provider-confirmed attendance actions.
- Inferred Worktivity boundaries, explicitly labeled with their observation
  time and inference provenance.
- Employee-authored progress or claims.
- Explicit employee-attached completion evidence: an upload and note, labeled
  as such and never provider-confirmed.
- AI-suggested interpretation.
- Work OS task state.
- Historical provider/Nifty state.
- Output evidence.
- Review/approval state.

Activity observation is not effort, productivity, completion, or quality.
Fresh Worktivity attendance status is the attendance source of truth; an
activity event alone is not a provider-confirmed clock action. Provider
credentials are not a verified connection. A successful browser request is not
a provider-confirmed mutation. Use labels, placement, and source/freshness copy
to keep meanings separate.

## Async states and dates

Every asynchronous surface defines:

| State | Required treatment |
|---|---|
| Initial loading | reserved geometry or content-shaped skeleton |
| Refreshing | current data remains visible with local refresh state |
| Empty | specific explanation and next useful action |
| Filtered empty | no-match copy and clear/reset |
| Dense | long titles, counts, and metadata remain aligned |
| Partial/degraded | last-known data plus source/freshness notice |
| Offline/queued | says queued locally, never confirmed remotely |
| Recoverable error | local error, retry, preserved input |
| Blocking error | bounded explanation and recovery route |
| Optimistic mutation | pending until authoritative confirmation |
| Confirmed success | receipt naming the persisted outcome |
| Read-only history | mutation controls removed, provenance retained |
| More available | a load control on the open edge, `Showing N of M`, and contiguous pages ([paged and streaming lists](data-and-state.md#paged-and-streaming-lists)) |

Dates, instants, timezone identifiers, durations, and range endpoints are
validated before formatting. Invalid values render —, Unavailable, or specific
fallback copy; they never throw.

**Date display.** Dates render in letter months, never as raw ISO timestamps
or numerals-only strings. Full dates read "Oct 16, 2026"
(`formatWorkOsFullDate`) in headers, table cells, records, and schedule lines;
dense rows may keep the contextual "October 16" (`formatWorkOsDate`) or
compact `shortDate` form. Relative forms ("2h ago") stay relative where the
interface reads a freshness interval. Recorded date columns can arrive
serialized as instants at UTC midnight; they keep their recorded calendar day
and never shift with the viewer's timezone, and timezone-aware times use
`formatWorkOsDateTime`. Native `<input type="date">` controls keep the
operating system's display format, so when a range filter matters the surface
states the applied range in letter-month form beside the control instead of
restyling the picker.

## Paged and streaming lists

A list that can grow in either direction loads contiguous pages on demand.

- Pages are 50 rows. A list keeps at most 100 rows mounted. Overflow is dropped
  from the edge away from the viewport, and that edge gets a load control.
- Loading is driven by a sentinel near the viewport, with a visible button as the
  fallback. Every page is contiguous with the rows already loaded, so the list
  never shows a gap.
- Arrivals at the top of a list that is already at the top appear in place. When
  the viewer is scrolled away, arrivals never move the view. One polite status
  line and one jump control report the count instead.
- Changing a filter or sort discards pages already in flight, so stale rows
  cannot land in the new result.
- The count states what is rendered. Use `Showing N of M` whenever more history
  exists.
- Counts are announced through one polite status region, never row by row.
- The Tasks list ([employee task views and ordering](../areas/tasks.md#views-and-ordering)) and the chat surfaces' recap streams ([activity interval reviews](../areas/recaps.md)) are the
  deliberate exceptions: they page at their own sizes (50 tasks, 12 recaps)
  behind one explicit load control and never a sentinel, so appending a page
  can never move the reader's position.

## Explicit list exceptions

Select the owner before applying the generic streaming defaults:

| List | Scoped behavior | Owner |
|---|---|---|
| Employee tasks | Explicit load control; retain appended rows | [Task views](../areas/tasks.md#views-and-ordering) |
| Recap history | Explicit load control; retain appended cards | [Recent activity stream](../areas/recaps.md#recent-activity-stream) |
| Memory facts | Independent explicit paging for each collection; retain loaded rows | [Work Memory](../areas/memory.md) |
| Organization tasks | Explicit Show more; desktop retains appended rows; see the owner for the web gap | [Admin task record](../admin/tasks.md#task-record) |
| Administration evidence | Its own initial bound and Show more control | [Evidence record](../admin/evidence.md#evidence-record) |

Keep the numerical limits in those owners. A shared pagination refactor must
preserve each exception rather than applying a sentinel or eviction policy to
every list.
