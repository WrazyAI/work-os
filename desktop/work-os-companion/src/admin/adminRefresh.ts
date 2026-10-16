import type { AdminSection } from "./types";

/** The administration sections that own a page-level refresh. Settings is
 * exempt: its decision areas edit the records they show, so the masthead
 * offers no page refresh while it is open (design.md §16.1). */
export type AdminRefreshSection = Exclude<AdminSection, "settings">;

/** Which reads back each section's views, as TanStack Query key prefixes.
 * Matching is element-wise and exact, so `["work-os","admin","task"]` covers
 * `["work-os","admin","task",id]` but never the sibling
 * `["work-os","admin","tasks",filters]`; both shapes are listed where a
 * section uses them. The shared `people`/`overview` prefixes appear only under
 * the sections whose pages actually read them. */
export const ADMIN_SECTION_REFRESH_PREFIXES: Record<AdminRefreshSection, readonly (readonly string[])[]> = {
  overview: [
    ["work-os", "admin", "overview"], // OverviewPage: overview(date)
  ],
  people: [
    ["work-os", "admin", "overview"], // PeoplePage: overview(today) roster context
    ["work-os", "admin", "people"], // PeoplePage: people()
    ["work-os", "admin", "person"], // PeoplePage: person(id) drawer record
  ],
  tasks: [
    ["work-os", "admin", "people"], // TasksPage: people() assignee selects
    ["work-os", "admin", "projects"], // TasksPage: projects()
    ["work-os", "admin", "tasks"], // TasksPage: tasks(filters)
    ["work-os", "admin", "task"], // TasksPage: taskDetails(id) drawer record
  ],
  review: [
    ["work-os", "admin", "reports"], // ReviewPage: reports(filters)
    ["work-os", "admin", "people"], // ReviewPage: people() reviewer context
    ["work-os", "admin", "report-evidence"], // ReviewPage: reportEvidence(personId, date)
    ["work-os", "admin", "report-intervals"], // ReviewPage: reportIntervals(personId, date)
  ],
  insights: [
    ["work-os", "admin", "insights"], // InsightsPage: insights(range, personId)
  ],
  evidence: [
    ["work-os", "admin", "people"], // EvidencePage: people() person filter
    ["work-os", "admin", "evidence"], // EvidencePage: evidence(filters)
    ["work-os", "admin", "intervals"], // EvidencePage: intervals(filters)
    ["work-os", "admin", "connections"], // EvidencePage: connections() provider band
    ["work-os", "admin", "github"], // EvidencePage: githubActors()/githubRepos()
  ],
};

/** The query-key prefixes whose reads back one refreshable administration
 * section. */
export function adminSectionRefreshPrefixes(section: AdminRefreshSection): readonly (readonly string[])[] {
  return ADMIN_SECTION_REFRESH_PREFIXES[section];
}

/** Exact element-wise prefix match, mirroring TanStack Query's partial-match
 * semantics: every prefix element must equal the query key's element at the
 * same position, and the key may carry the section's own refinements after
 * the prefix. */
function queryKeyMatchesPrefix(queryKey: readonly unknown[], prefix: readonly string[]): boolean {
  return queryKey.length >= prefix.length && prefix.every((part, index) => queryKey[index] === part);
}

/** True when a query key belongs to the section's page reads. Settings owns no
 * refresh-scoped reads, so every key is excluded there. */
export function adminSectionQueryMatches(section: AdminSection, queryKey: readonly unknown[]): boolean {
  if (section === "settings") return false;
  return adminSectionRefreshPrefixes(section).some((prefix) => queryKeyMatchesPrefix(queryKey, prefix));
}
