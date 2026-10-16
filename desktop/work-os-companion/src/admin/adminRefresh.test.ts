import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_SECTION_REFRESH_PREFIXES, adminSectionQueryMatches, adminSectionRefreshPrefixes, type AdminRefreshSection } from "./adminRefresh";
import { adminKeys } from "./data";
import type { AdminSection } from "./types";

/** Build a representative cache key from a builder name: the pages call the
 * builders with their own filters, but coverage is a property of the prefix,
 * so placeholder arguments are enough. */
const builders = adminKeys as unknown as Record<string, (...args: string[]) => readonly unknown[]>;
const keyFor = (builder: string) => builders[builder]("placeholder", "placeholder");

const PAGE_SECTIONS: Array<{ file: string; section: AdminRefreshSection }> = [
  { file: "OverviewPage.tsx", section: "overview" },
  { file: "PeoplePage.tsx", section: "people" },
  { file: "TasksPage.tsx", section: "tasks" },
  { file: "ReviewPage.tsx", section: "review" },
  { file: "InsightsPage.tsx", section: "insights" },
  { file: "EvidencePage.tsx", section: "evidence" },
];

function adminKeyBuildersIn(file: string): string[] {
  const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  return [...new Set([...source.matchAll(/adminKeys\.(\w+)\(/g)].map((match) => match[1]))];
}

describe("administration section refresh mapping", () => {
  it("matches a section's own reads, including refined keys", () => {
    expect(adminSectionQueryMatches("overview", adminKeys.overview("2026-10-16"))).toBe(true);
    expect(adminSectionQueryMatches("people", adminKeys.overview("2026-10-16"))).toBe(true);
    expect(adminSectionQueryMatches("people", adminKeys.people())).toBe(true);
    expect(adminSectionQueryMatches("people", adminKeys.person("p-1"))).toBe(true);
    expect(adminSectionQueryMatches("insights", adminKeys.insights("7d", "p-1"))).toBe(true);
    expect(adminSectionQueryMatches("review", adminKeys.reports({ status: "pending_review" }))).toBe(true);
    expect(adminSectionQueryMatches("review", adminKeys.reportEvidence("p-1", "2026-10-16"))).toBe(true);
    expect(adminSectionQueryMatches("review", adminKeys.reportIntervals("p-1", "2026-10-16"))).toBe(true);
  });

  it("keeps sibling collections apart: tasks and task, reports and report-evidence", () => {
    // Prefix matching is exact per element: the collection keys and the detail
    // keys are different siblings, and both are covered where the page uses
    // them.
    const tasksPrefixes = adminSectionRefreshPrefixes("tasks");
    expect(tasksPrefixes).toContainEqual(["work-os", "admin", "tasks"]);
    expect(tasksPrefixes).toContainEqual(["work-os", "admin", "task"]);
    expect(adminSectionQueryMatches("tasks", adminKeys.tasks({ filter: "open" }))).toBe(true);
    expect(adminSectionQueryMatches("tasks", adminKeys.taskDetails("t-1"))).toBe(true);
    // A "task" prefix never swallows the "tasks" collection, or vice versa.
    expect(adminSectionQueryMatches("overview", adminKeys.tasks({ filter: "open" }))).toBe(false);
    expect(adminSectionQueryMatches("tasks", ["work-os", "admin", "tasksDetails", "t-1"])).toBe(false);
    // Review's reports prefix does not cover report-evidence (same sibling
    // distinction), so both browser prefixes are declared explicitly.
    expect(adminSectionQueryMatches("review", adminKeys.reportEvidence("p-1", "2026-10-16"))).toBe(true);
    expect(adminSectionQueryMatches("review", ["work-os", "admin", "reports-evidence", "p-1"])).toBe(false);
  });

  it("covers the github integration reads and activity intervals under their own prefixes", () => {
    expect(adminSectionQueryMatches("evidence", adminKeys.githubActors())).toBe(true);
    expect(adminSectionQueryMatches("evidence", adminKeys.githubRepos())).toBe(true);
    expect(adminSectionQueryMatches("evidence", adminKeys.intervals({ from: "2026-10-01", to: "2026-10-16" }))).toBe(true);
    // Neither the github branch nor the employee intervals branch leaks out.
    expect(adminSectionQueryMatches("review", adminKeys.githubActors())).toBe(false);
    expect(adminSectionQueryMatches("evidence", ["work-os", "activity-intervals", "2026-10-16"])).toBe(false);
  });

  it("never matches a shorter or unrelated key", () => {
    expect(adminSectionQueryMatches("overview", ["work-os", "admin"])).toBe(false);
    expect(adminSectionQueryMatches("overview", ["work-os", "admin", "person", "p-1"])).toBe(false);
    // The employee cache branch shares the "work-os" root but not the admin
    // namespace.
    expect(adminSectionQueryMatches("tasks", ["work-os", "task", "t-1"])).toBe(false);
    expect(adminSectionQueryMatches("overview", ["work-os", "day", "compact"])).toBe(false);
  });

  it("excludes settings from every section's mapping", () => {
    const buildersUsed = [
      "overview", "people", "person", "projects", "tasks", "taskDetails", "reports",
      "reportEvidence", "reportIntervals", "insights", "evidence", "intervals",
      "githubActors", "githubRepos", "connections",
    ];
    for (const builder of buildersUsed) {
      expect(adminSectionQueryMatches("settings", keyFor(builder)), builder).toBe(false);
    }
    // The helper only exists for the six refreshable sections; the settings
    // exemption is a property of the predicate, not a prefix list.
    expect("settings" in ADMIN_SECTION_REFRESH_PREFIXES).toBe(false);
  });

  it("exposes the same prefix lists through the helper", () => {
    for (const section of Object.keys(ADMIN_SECTION_REFRESH_PREFIXES) as AdminRefreshSection[]) {
      expect(adminSectionRefreshPrefixes(section)).toBe(ADMIN_SECTION_REFRESH_PREFIXES[section]);
      for (const prefix of adminSectionRefreshPrefixes(section)) {
        expect(prefix.slice(0, 2), section).toEqual(["work-os", "admin"]);
      }
    }
  });
});

describe("administration page query drift", () => {
  it("covers every adminKeys read each page makes", () => {
    for (const { file, section } of PAGE_SECTIONS) {
      const referenced = adminKeyBuildersIn(file);
      expect(referenced.length, `${file} makes no adminKeys reads`).toBeGreaterThan(0);
      for (const builder of referenced) {
        expect(builders[builder], `${file} references unknown adminKeys.${builder}`).toBeTypeOf("function");
        expect(
          adminSectionQueryMatches(section, keyFor(builder)),
          `${section} does not cover ${file}'s adminKeys.${builder}()`,
        ).toBe(true);
      }
    }
  });

  it("keeps every settings-page read outside the refresh predicate", () => {
    const referenced = adminKeyBuildersIn("SettingsPage.tsx");
    expect(referenced.length).toBeGreaterThan(0);
    for (const builder of referenced) {
      expect(
        adminSectionQueryMatches("settings", keyFor(builder)),
        `settings unexpectedly matches adminKeys.${builder}()`,
      ).toBe(false);
    }
  });

  it("covers every reader of the shared roster and overview prefixes where they are read", () => {
    // The shared prefixes are declared only under the sections whose pages
    // read them (the guard above proves every read is covered); this pins the
    // intended readers so a removed/added shared read is a visible diff.
    const shared: Record<"people" | "overview", AdminSection[]> = { people: [], overview: [] };
    for (const section of Object.keys(ADMIN_SECTION_REFRESH_PREFIXES) as AdminRefreshSection[]) {
      for (const prefix of adminSectionRefreshPrefixes(section)) {
        if (prefix.join("/") === "work-os/admin/people") shared.people.push(section);
        if (prefix.join("/") === "work-os/admin/overview") shared.overview.push(section);
      }
    }
    expect(shared.people).toEqual(["people", "tasks", "review", "evidence"]);
    expect(shared.overview).toEqual(["overview", "people"]);
  });
});
