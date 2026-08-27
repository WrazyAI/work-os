import assert from "node:assert/strict";
import test from "node:test";
import { parseInterpretation } from "../src/lib/aiInterpret";

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
