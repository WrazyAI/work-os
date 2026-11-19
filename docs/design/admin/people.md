# Administration people and person record

**Use when:** Changing the roster, person drawer, mappings, workdays, or arrangement review.

**Owns:** Coverage facts and named destinations from a person record.

**Requires:** [Shared foundations](../foundations.md); [Administration shell and shared contracts](shell.md) (read each once per task).

**Read next only if:**

- Changing arrangements or approval: [Profile, connected accounts, and work arrangements](../areas/profile-and-schedule.md).
- Changing report destinations: [Administration EOD review](eod-review.md).
- Changing recap destinations: [Admin Otto tools and decisions](otto.md).

**Implementation starting points:** [PeoplePage.tsx](../../../desktop/work-os-companion/src/admin/PeoplePage.tsx).

## People and person record

**People** is a coverage table with a person drawer: mappings, today's
record, schedule and exceptions, recent workdays, reports, updates, and a
seven-day evidence summary. The roster names each person's recap count,
completed-task count, evidence count, and latest recap; EOD shows the report
status or a dash, never an invented state. Search, role, and attendance
filters sit in one controls row. The drawer is where a mapping or role is set.
**Person record.** The drawer's Today record reads status now, observed time,
Updates (ready interval recaps recorded today), Outcomes (tasks completed
today), Evidence (today's evidence), and EOD (the day's report status, or a
dash when no report exists). Updates opens Admin Otto on its Recaps tab,
Outcomes opens Tasks filtered to the person in the Completed view, Evidence
opens Evidence filtered to the person, and EOD opens that day's report in EOD
Review. Recent workdays is one row per day with that day's observed session
time and recap count. Updates lists that day's recaps with `View all recaps`;
every report row opens its report in EOD Review with the person filtered, and
`View all reports` opens the same filtered queue. A value with no record stays
a dash, and an outstanding EOD is never turned into a second status. Today's
measures sit in a three-column grid at the wide drawer class and two columns
at narrow widths; a measure with a destination underlines its value, while a
value with no record stays a quiet fact.
