import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scriptUrl = new URL("../scripts/work-os-ledger.mjs", import.meta.url);
const { LEDGER_LABEL, envFileCandidates, parseArgs, parseEnvToken, readLedgerDocument, taskPayload } = await import(scriptUrl.href);
const scriptSource = readFileSync(scriptUrl, "utf8");

test("the ledger parses positional ids and value flags", () => {
  const flags = parseArgs(["complete", "abc-1", "abc-2", "--json-output"]);
  assert.deepEqual(flags._, ["complete", "abc-1", "abc-2"]);
  assert.equal(flags.jsonOutput, true);

  const create = parseArgs(["create", "--project-name", "EOD Report", "--dry-run"]);
  assert.equal(create.projectName, "EOD Report");
  assert.equal(create.dryRun, true);

  assert.throws(() => parseArgs(["create", "--nope", "x"]), /Unknown flag/);
});

test("a ledger task always carries the ledger label", () => {
  const payload = taskPayload({ name: "Ship the ledger", labels: ["release"] }, { labels: [LEDGER_LABEL, "ops"] });
  assert.deepEqual(payload.labels, [LEDGER_LABEL, "ops", "release"]);
  assert.equal(payload.name, "Ship the ledger");
});

test("a task payload keeps only the fields the API accepts and drops empties", () => {
  const payload = taskPayload(
    { name: "  Trim me  ", description: "  short  ", due_date: "2026-11-02", priority: "high", story_points: 3 },
    { projectId: "project-1", parentId: "parent-1" },
  );
  assert.deepEqual(payload, {
    name: "Trim me",
    labels: [LEDGER_LABEL],
    description: "short",
    due_date: "2026-11-02",
    priority: "high",
    story_points: 3,
    project_id: "project-1",
    parent_task_id: "parent-1",
  });
  assert.equal(taskPayload({ name: "Bare" }, {}).description, undefined);
});

test("a task without a name is refused before any write", () => {
  assert.throws(() => taskPayload({ name: "   " }, {}), /needs a name/);
  assert.throws(() => taskPayload(null, {}), /must be an object/);
});

test("the ledger document accepts the retired logger's shape", () => {
  const doc = readLedgerDocument(JSON.stringify({
    project_id: "czFZk9928z",
    labels: ["ops", 7],
    existing_parent_task_id: "parent-9",
    tasks: [{ name: "Parent", subtasks: ["Child"] }],
  }));
  assert.equal(doc.projectId, "czFZk9928z");
  assert.equal(doc.parentId, "parent-9");
  assert.deepEqual(doc.labels, ["ops"]);
  assert.throws(() => readLedgerDocument({ tasks: [] }), /at least one task/);
});

test("the ledger reads either token name from a repo env file", () => {
  assert.equal(parseEnvToken("OTHER=1\nWORK_OS_API_TOKEN=abc\nWORK_OS_AGENT_TOKEN=def\n"), "abc");
  assert.equal(parseEnvToken("WORK_OS_AGENT_TOKEN=legacy\nWORK_OS_API_TOKEN=canonical\n"), "canonical");
  assert.equal(parseEnvToken('WORK_OS_AGENT_TOKEN="legacy-token"\n'), "legacy-token");
  assert.equal(parseEnvToken("WORK_OS_API_TOKEN='quoted'\n"), "quoted");
  assert.equal(parseEnvToken("export WORK_OS_API_TOKEN=exported\n"), "exported");
  assert.equal(parseEnvToken("WORK_OS_API_TOKEN =\tspaced\n"), "spaced");
  assert.equal(parseEnvToken("WORK_OS_API_TOKEN=\n"), null);
  assert.equal(parseEnvToken("UNRELATED=value\n"), null);
});

test("the ledger resolves the main checkout env from a worktree", () => {
  const candidates = envFileCandidates(new URL("..", import.meta.url).pathname, {});
  assert.ok(candidates.some((path: string) => path.endsWith("/.env.local")), "expected a repo .env.local candidate");
  assert.ok(candidates.some((path: string) => path.endsWith("/.env")), "expected a repo .env candidate");
  assert.equal(new Set(candidates).size, candidates.length, "env candidates should be de-duplicated");

  const explicit = envFileCandidates(new URL("..", import.meta.url).pathname, { WORK_OS_LEDGER_ENV_FILE: "/tmp/ledger.env" });
  assert.equal(explicit[0], "/tmp/ledger.env");
});

test("the ledger never prints or persists the token", () => {
  assert.doesNotMatch(scriptSource, /console\.(log|error)\([^)]*\btoken\b/i);
  assert.doesNotMatch(scriptSource, /writeFileSync\([^)]*token/i);
  assert.match(scriptSource, /Authorization: `Bearer \$\{token\}`/);
});
