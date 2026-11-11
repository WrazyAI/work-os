import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminOttoPendingAction, AdminRead } from "../../../../src/modules/work-os/admin-otto/contracts";
import { AdminActionBatch, AdminReadCard, createAdminActionSession, type AdminToolAction } from "./AdminToolCards";
import { FIXTURE_REVIEWED_RECAP, fixtureRecordsResult, fixtureTaskResult } from "./fixtures";

const action = (id = "private-preview", extra: Partial<AdminToolAction> = {}): AdminToolAction => ({
  previewId: id, action: "create_task", summary: "Create task", expiresAt: "2099-11-04T10:00:00Z", warnings: [],
  changes: [{ field: "assignee_ids", from: [], to: ["private-person"] }],
  display: { title: "Prepare launch", assignees: [{ id: "private-person", displayName: "Ada", active: true, timezone: "UTC" }],
    changes: [{ label: "Due date", before: null, after: "2026-11-06" }, { label: "Priority", before: "Normal", after: "Normal" }] }, ...extra,
});
const read = (result: AdminRead, more = {}) => renderToStaticMarkup(createElement(AdminReadCard, {
  result, onOpenRecord() {}, onOpenRecap() {}, onListen() {}, ...more,
}));
const batch = (actions: AdminToolAction[], more = {}) => renderToStaticMarkup(createElement(AdminActionBatch, {
  actions, onConfirm: async (value: AdminOttoPendingAction) => value, ...more,
}));

describe("admin read cards", () => {
  it("keeps named task context and true totals without printing identifiers", () => {
    const html = read(fixtureTaskResult());
    expect(html).toContain("Synthetic Ada");
    expect(html).toContain("Subtask of Prepare the admin rollout");
    expect(html).toContain("Showing 1 of 4");
    expect(html).not.toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
  it("offers explicit continuation and never makes untrusted URLs actionable", () => {
    const result = fixtureTaskResult();
    if (result.kind !== "tasks") throw new Error("fixture");
    result.page.nextCursor = "private-cursor";
    result.page.items[0].recordUrl = "javascript:alert(1)";
    const html = read(result, { onLoadMore() {} });
    expect(html).toContain("Load more");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("private-cursor");
  });
  it.each(["update", "submitted_eod", "workday"] as const)("renders %s with its own source layout and human provenance", (source) => {
    const result = fixtureRecordsResult();
    if (result.kind !== "records") throw new Error("fixture");
    Object.assign(result.page.items[0], { source, person: { displayName: "Ada" }, text: "<script>unsafe()</script>" });
    const html = read(result);
    expect(html).toContain(`admin-tool-record--${source}`);
    expect(html).toContain("Ada");
    expect(html).toContain("Oct 26, 2026");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("renders a submitted EOD as a safe document instead of raw heading markers", () => {
    const result = fixtureRecordsResult();
    if (result.kind !== "records") throw new Error("fixture");
    Object.assign(result.page.items[0], {
      source: "submitted_eod",
      text: "## Summary\nNo recorded progress update.\n\n## Completed\nNothing completed yet.",
    });
    const html = read(result);
    expect(html).toContain("<h3>Summary</h3>");
    expect(html).toContain("No recorded progress update.");
    expect(html).not.toContain("## Summary");
  });
  it("preserves reviewed recap correction and real playback stop behavior", () => {
    const html = read({ kind: "recap", recap: FIXTURE_REVIEWED_RECAP }, { playback: {
      intervalId: FIXTURE_REVIEWED_RECAP.intervalId, status: "playing", lines: [], progress: 0, activeIndex: 0, slow: false,
    } });
    expect(html).toContain("Employee correction");
    expect(html).toContain("Stop reading the recap for Synthetic Ada");
    expect(html).not.toMatch(/Looks good|Confirm recap|Clock in/);
  });
  it("renders recap lists and actionable ambiguity without exposing person IDs", () => {
    const recapHtml = read({ kind: "recaps", page: { items: [FIXTURE_REVIEWED_RECAP], total: 1, nextCursor: null, asOf: "", coverage: [] } });
    expect(recapHtml).toContain("View recap");
    expect(recapHtml).toContain("Listen");
    const html = read({ kind: "resolution", resolution: { kind: "ambiguous", name: "Ada", choices: [FIXTURE_REVIEWED_RECAP.person] } }, { onChoosePerson() {} });
    expect(html).toContain("Choose Synthetic Ada");
    expect(html).not.toContain(FIXTURE_REVIEWED_RECAP.person.id);
  });
  it("explains empty and missing results", () => {
    const result = fixtureTaskResult();
    if (result.kind === "tasks") result.page.items = [];
    expect(read(result)).toContain("No tasks matched");
    expect(read({ kind: "resolution", resolution: { kind: "missing", name: "Ada" } })).toContain("No employee named Ada");
  });
});

describe("admin explicit approvals", () => {
  it("shows creation facts, human names and only meaningful changes", () => {
    const html = batch([action()]);
    expect(html).toContain("Prepare launch");
    expect(html).toContain("Ada");
    expect(html).toContain("Nov 6, 2026");
    expect(html).toContain("Create task");
    expect(html).not.toMatch(/private-person|private-preview|Priority|→|Expires/);
  });
  it("has one counted batch approval and selection only for pending items", () => {
    const html = batch([action("one"), action("two"), action("done", { status: "recorded" })]);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/Create 2 tasks/g)).toHaveLength(1);
    expect(html).toContain("Task created");
  });
  it.each([
    ["expired", "expired"], ["in_flight", "Checking"], ["abandoned", "Not applied"], ["unknown", "not confirmed"],
  ] as const)("renders %s with no blind confirmation", (status, text) => {
    const html = batch([action("one", { status })], { onRefresh: async (a: AdminOttoPendingAction) => a });
    expect(html).toContain(text);
    expect(html).not.toContain(">Create task</button>");
  });
  it("escapes hostile long titles and hides unsafe legacy identifier diffs", () => {
    const html = batch([action("one", { display: undefined, summary: "<img onerror=evil>".repeat(100) })]);
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/<img|private-person|assignee_ids/);
  });
  it("prevents duplicate confirms synchronously, then permanently locks successful items", async () => {
    let resolve!: (a: AdminToolAction) => void;
    let calls = 0;
    const session = createAdminActionSession([action()]);
    const confirm = () => { calls++; return new Promise<AdminToolAction>((done) => { resolve = done; }); };
    const first = session.confirmSelected(confirm);
    await session.confirmSelected(confirm);
    expect(calls).toBe(1);
    resolve(action(undefined, { status: "recorded" }));
    await first;
    await session.confirmSelected(confirm);
    expect(calls).toBe(1);
    expect(session.snapshot()[0].action.status).toBe("recorded");
  });
  it("keeps independent partial receipts and requires refresh after an unknown network result", async () => {
    const session = createAdminActionSession([action("one"), action("two")]);
    await session.confirmSelected(async (a) => {
      if (a.previewId === "two") throw new Error("private stack");
      return { ...a, status: "recorded" };
    });
    expect(session.snapshot().map((row) => row.action.status)).toEqual(["recorded", "unknown"]);
    expect(session.snapshot()[1].message).not.toContain("private stack");
    let retries = 0;
    await session.confirmSelected(async (a) => { retries++; return a; });
    expect(retries).toBe(0);
    await session.refresh("two", async (a) => ({ ...a, status: "pending" }));
    expect(session.snapshot()[1].action.status).toBe("pending");
    expect(session.snapshot()[1].selected).toBe(false);
    session.toggle("two");
    await session.confirmSelected(async (a) => ({ ...a, status: "recorded" }));
    expect(session.snapshot()[1].action.status).toBe("recorded");
  });
  it.each(["preview_stale", "preview_expired", "preview_in_flight"])("maps typed %s failures without exposing server diagnostics", async (reason) => {
    const session = createAdminActionSession([action()]);
    await session.confirmSelected(async () => { throw { reason, message: "private diagnostics" }; });
    const row = session.snapshot()[0];
    expect(row.action.status).not.toBe("pending");
    expect(row.message).not.toContain("private diagnostics");
    expect(row.message).toBeTruthy();
  });
  it("does not let stale parent props reset a recorded receipt", async () => {
    const pending = action();
    const session = createAdminActionSession([pending]);
    await session.confirmSelected(async (a) => ({ ...a, status: "recorded" }));
    session.setActions([pending]);
    expect(session.snapshot()[0].action.status).toBe("recorded");
  });
  it("preserves user exclusions across parent rerenders", () => {
    const pending = action();
    const session = createAdminActionSession([pending]);
    session.toggle(pending.previewId);
    session.setActions([{ ...pending }]);
    expect(session.snapshot()[0].selected).toBe(false);
  });
  it("requires authoritative confirmation rather than treating a pending response as success", async () => {
    const session = createAdminActionSession([action()]);
    await session.confirmSelected(async (a) => ({ ...a, status: "pending" }));
    expect(session.snapshot()[0].action.status).toBe("unknown");
    expect(session.snapshot()[0].selected).toBe(false);
  });
  it("lets an authoritative recorded parent update resolve an uncertain receipt", async () => {
    const pending = action();
    const session = createAdminActionSession([pending]);
    await session.confirmSelected(async () => { throw new Error("network"); });
    session.setActions([{ ...pending, status: "recorded" } as AdminToolAction]);
    expect(session.snapshot()[0].action.status).toBe("recorded");
  });
  it("does not show a removed or duplicated creation fact as a null diff", () => {
    const preview = action();
    preview.display!.changes.push({ label: "Title", before: null, after: "Prepare launch" }, { label: "Removed date", before: "2026-11-04", after: null });
    const html = batch([preview]);
    expect(html.match(/Prepare launch/g)).toHaveLength(1);
    expect(html).not.toContain("Removed date");
  });
});
