import assert from "node:assert/strict";
import test from "node:test";

import { compareTaskRecency, taskRecencyStamp } from "../src/lib/work-os";

test("recency prefers provider activity, then provider creation, then the local row", () => {
  assert.equal(
    taskRecencyStamp({ provider_updated_at: "2026-09-18T10:00:00Z", provider_created_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-17T00:00:00Z" }),
    "2026-09-18T10:00:00Z",
  );
  assert.equal(
    taskRecencyStamp({ provider_updated_at: null, provider_created_at: "2026-08-20T00:00:00Z", created_at: "2026-08-21T00:00:00Z" }),
    "2026-08-20T00:00:00Z",
  );
  assert.equal(
    taskRecencyStamp({ provider_updated_at: null, provider_created_at: null, created_at: "2026-08-21T00:00:00Z", updated_at: "2026-08-26T00:00:00Z" }),
    "2026-08-21T00:00:00Z",
  );
});

test("recency accepts the pg driver's Date objects as well as ISO strings", () => {
  const fromDate = taskRecencyStamp({ provider_created_at: new Date("2026-09-18T10:30:00.000Z"), created_at: "2026-09-17T00:00:00Z" });
  assert.equal(fromDate, "2026-09-18T10:30:00.000Z");
  const sorted = [
    { id: "older", title: "Older", created_at: new Date("2026-01-16T00:00:00Z") },
    { id: "newer", title: "Newer", created_at: new Date("2026-09-18T00:00:00Z") },
  ].sort(compareTaskRecency).map((task) => task.id);
  assert.deepEqual(sorted, ["newer", "older"]);
  assert.equal(taskRecencyStamp({ provider_created_at: new Date("invalid") }), "");
});

test("recency sorts newest first and the mirror sync time never outranks creation", () => {
  const tasks = [
    { id: "old", title: "Old task", created_at: "2026-01-16T00:00:00Z", provider_created_at: "2026-01-16T00:00:00Z", updated_at: "2026-08-26T21:37:50Z" },
    { id: "new", title: "New task", created_at: "2026-09-18T00:00:00Z", provider_created_at: "2026-09-18T00:00:00Z", updated_at: "2026-08-26T21:37:47Z" },
    { id: "mid", title: "Mid task", created_at: "2026-08-20T00:00:00Z", provider_created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-26T21:37:49Z" },
  ];
  const sorted = [...tasks].sort(compareTaskRecency).map((task) => task.id);
  assert.deepEqual(sorted, ["new", "mid", "old"]);
});
