import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminOttoChatEntry, resultSummary } from "./AdminOttoChatEntry";

const scope = { userId: "user-1", organizationId: "org-1", mode: "admin" as const };

describe("admin Otto entry scaffold", () => {
  it("opens a scoped read-only dialog with no employee decision controls", () => {
    const html = renderToStaticMarkup(createElement(AdminOttoChatEntry, {
      scope,
      onClose: () => undefined,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Ask Otto about the team");
    expect(html).toContain("Read-only.");
    expect(html).toContain('for="admin-otto-entry-input"');
    expect(html).not.toContain("Looks good");
    expect(html).not.toContain("Add or correct");
    expect(html).not.toContain('href="http');
  });

  it("summarizes typed results without inventing counts", () => {
    expect(resultSummary({
      kind: "tasks",
      page: { items: [], nextCursor: null, total: 2, asOf: "2026-10-24T12:00:00.000Z", coverage: [] },
      people: [],
    })).toBe("2 tasks in this result.");
    expect(resultSummary({
      kind: "resolution",
      resolution: { kind: "missing", name: "Ada" },
    })).toBe("No employee named Ada was found.");
    expect(resultSummary({
      kind: "resolution",
      resolution: {
        kind: "ambiguous",
        name: "Sam",
        choices: [{ id: "person-1", displayName: "Sam Lee", active: true, timezone: "UTC" }],
      },
    })).toBe("Which Sam did you mean?");
  });
});
