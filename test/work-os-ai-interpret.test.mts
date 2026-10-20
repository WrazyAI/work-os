import assert from "node:assert/strict";
import test from "node:test";
import { INTERPRET_RESPONSE_SCHEMA, orderInterpretationTasks, parseInterpretation } from "../src/lib/aiInterpret";

const TASKS = [
  { id: "t-1", title: "Ship the debugger fix", completed: false },
  { id: "t-2", title: "Package the Windows build", completed: false },
];

test("parses a well-formed model response into the typed contract", () => {
  const parsed = parseInterpretation({
    taskMatches: [{ taskId: "t-1", confidence: 0.9 }, { taskId: "t-2", confidence: 0.5 }],
    claims: [{ kind: "completion", statement: "Debugger fix is done.", taskId: "t-1" }],
    operations: [
      { op: "complete_task", statement: "Mark the debugger fix complete.", taskId: "t-1" },
      { op: "create_task", statement: "Package the signed installer.", taskTitle: "Package the signed installer" },
    ],
  }, "debugger fix done, need to package the installer", TASKS);
  assert.equal(parsed?.originalInput, "debugger fix done, need to package the installer");
  assert.equal(parsed.taskMatches.length, 2);
  assert.equal(parsed.claims[0]?.kind, "completion");
  assert.equal(parsed.operations.length, 2);
  assert.equal(parsed.operations[0]?.taskId, "t-1");
  assert.equal(parsed.operations[1]?.taskTitle, "Package the signed installer");
});

test("drops operations referencing task ids outside the server-fetched list", () => {
  const parsed = parseInterpretation({
    operations: [
      { op: "complete_task", statement: "Mark foreign task complete.", taskId: "other-org-task" },
      { op: "complete_task", statement: "Mark known task complete.", taskId: "t-1" },
    ],
    claims: [],
  }, "update", TASKS);
  assert.equal(parsed?.operations.length, 1);
  assert.equal(parsed?.operations[0]?.taskId, "t-1");
});

test("drops invalid entries, keeps an empty-but-valid result, and rejects non-objects", () => {
  const parsed = parseInterpretation({ operations: [{ op: "complete_task", statement: "no id" }] }, "update", TASKS);
  assert.equal(parsed?.operations.length, 0);
  assert.equal(parseInterpretation("not an object", "update", TASKS), null);
  const nonsense = parseInterpretation({ claims: [{ kind: "nonsense", statement: "x" }] }, "update", TASKS);
  assert.equal(nonsense?.claims.length, 0);
});

test("empty model output stays a valid empty interpretation", () => {
  const parsed = parseInterpretation({ taskMatches: [], claims: [], operations: [] }, "nothing to report", TASKS);
  assert.equal(parsed?.operations.length, 0);
  const empty = parseInterpretation({}, "update", TASKS);
  assert.equal(empty?.operations.length, 0);
});

function assertStrictRequired(node: unknown, path = "root") {
  if (!node || typeof node !== "object") return;
  const schema = node as { properties?: Record<string, unknown>; required?: unknown[]; items?: unknown };
  if (schema.properties) {
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of Object.keys(schema.properties)) {
      assert.ok(required.includes(key), `${path}.${key} must be required for strict json_schema`);
      assertStrictRequired(schema.properties[key], `${path}.${key}`);
    }
  }
  if (schema.items) assertStrictRequired(schema.items, `${path}[]`);
}

test("strict response schema requires every declared property", () => {
  assertStrictRequired(INTERPRET_RESPONSE_SCHEMA.schema);
});

test("strict-schema nulls for optional fields are normalized away", () => {
  const parsed = parseInterpretation({
    reply: "Got it.",
    taskMatches: [],
    claims: [{ kind: "progress", statement: "Still working.", taskId: null }],
    operations: [{ op: "record_progress", statement: "Still working on it.", taskId: null, taskTitle: null, taskGroupId: null, limit: null, page: null }],
  }, "still working", TASKS);
  assert.equal(parsed?.reply, "Got it.");
  assert.equal(parsed?.claims[0]?.taskId, undefined);
  assert.equal(parsed?.operations.length, 0);
});

test("interpretation context is ordered for today's work, not oldest-first", () => {
  const rows = [
    { id: "old-due", title: "January compliance review", due_date: "2026-01-16", completed: false, provider_updated_at: "2026-01-16T10:00:00Z" },
    { id: "today-due", title: "Ship the proposals fix", due_date: "2026-09-16", completed: false, provider_updated_at: "2026-09-16T01:00:00Z" },
    { id: "no-due-recent", title: "Carried over null-due task", due_date: null, completed: false, provider_updated_at: "2026-09-15T22:00:00Z" },
    { id: "done-yesterday", title: "Finished yesterday", due_date: "2026-09-15", completed: true, provider_updated_at: "2026-09-15T20:00:00Z" },
  ];
  const ordered = orderInterpretationTasks(rows, "2026-09-16");
  assert.deepEqual(ordered.map((task) => task.id), ["today-due", "old-due", "no-due-recent", "done-yesterday"]);
  assert.equal(ordered[0]?.completed, false);
  assert.equal(ordered.at(-1)?.completed, true);
});

test("interpretation context caps at the newest open work and skips malformed rows", () => {
  const rows: Array<Record<string, unknown>> = Array.from({ length: 320 }, (_, index) => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    due_date: null,
    completed: false,
    provider_updated_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
  }));
  rows.push({ id: 42, title: "bad id" });
  const ordered = orderInterpretationTasks(rows, "2026-09-16", 300);
  assert.equal(ordered.length, 300);
  assert.equal(ordered[0]?.id, "task-319");
  assert.ok(!ordered.some((task) => task.title === "bad id"));
});

test("the prompt leads with the reusable blocks and ends with the employee's words", async () => {
  // The provider caches a stable prefix. With a few hundred tasks the task list
  // and the rules are the bulk of the prompt, so they must come before the
  // update, the day state, the memory block and the recent conversation.
  const { readFile } = await import("node:fs/promises");
  const lib = await readFile(new URL("../src/lib/aiInterpret.ts", import.meta.url), "utf8");
  const prompt = lib.slice(lib.indexOf("function buildPrompt("), lib.indexOf("export interface InterpretResult"));
  const order = [
    "Convert the update into structured operations",
    "Their tasks:",
    "taskList,",
    "blueprintBlock,",
    "`Today is ${today}.`",
    "context?.todayBlock",
    "context?.memoryBlock",
    "Recent conversation:",
    "loomBlock,",
    "The employee wrote this update:",
    '`"""${input}"""`',
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = prompt.indexOf(marker);
    assert.ok(at >= 0, `prompt is missing ${marker}`);
    assert.ok(at > cursor, `${marker} must come after the block before it`);
    cursor = at;
  }
});

test("the prompt never points at a block by position", async () => {
  // The rules used to say "the list above"; a reorder would silently falsify
  // that. Name the block instead so the order can change safely.
  const { readFile } = await import("node:fs/promises");
  const lib = await readFile(new URL("../src/lib/aiInterpret.ts", import.meta.url), "utf8");
  const prompt = lib.slice(lib.indexOf("function buildPrompt("), lib.indexOf("export interface InterpretResult"));
  assert.doesNotMatch(prompt, /the list above/i);
});

test("the check-in prompt puts the reusable task list before the employee's words", async () => {
  // Same prefix-cache reason as the interpret prompt: the task list repeats
  // across check-ins, the employee's sentence does not.
  const { readFile } = await import("node:fs/promises");
  const lib = await readFile(new URL("../src/lib/work-os-checkins.ts", import.meta.url), "utf8");
  const at = lib.indexOf('{ role: "user", content: JSON.stringify({');
  assert.ok(at >= 0, "the check-in user turn must be a JSON payload");
  const payload = lib.slice(at, lib.indexOf("}) },", at));
  assert.ok(payload.indexOf("currentTasks") < payload.indexOf("employeeInput"), "the task list must lead the payload");
});
