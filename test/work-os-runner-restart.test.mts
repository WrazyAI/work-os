import assert from "node:assert/strict";
import {
  collectRunnerImports,
  resolveSpecifier,
  runnerRelevantChanges,
} from "../scripts/runner-restart-check.mts";

/** Guards the redeploy runner-staleness check: the import walker must follow
 * static imports, re-exports, and dynamic imports across the `@/` alias and
 * relative paths, and only changed files inside that closure may trigger the
 * restart warning. */

const files = new Map<string, string>([
  ["scripts/agent-runner.ts", 'import { stringify } from "@/lib/format";\nimport "./runner-helper";\n'],
  ["scripts/runner-helper.ts", 'const lazy = import("@/lib/lazy");\n'],
  ["src/lib/format.ts", 'export * from "./db/query";\n'],
  ["src/lib/lazy.ts", ""],
  ["src/lib/db/query.ts", ""],
]);
const io = {
  exists: (path: string) => files.has(path),
  read: (path: string) => files.get(path) ?? "",
};

const closure = collectRunnerImports("scripts/agent-runner.ts", io);
assert.ok(closure.has("scripts/agent-runner.ts"));
assert.ok(closure.has("scripts/runner-helper.ts"));
assert.ok(closure.has("src/lib/format.ts"), "aliased imports must resolve");
assert.ok(closure.has("src/lib/db/query.ts"), "re-exports must be followed");
assert.ok(closure.has("src/lib/lazy.ts"), "dynamic imports must be followed");

const relevant = runnerRelevantChanges(
  ["src/lib/format.ts", "docs/notes.md", "desktop/app.tsx", "scripts/runner-helper.ts"],
  closure,
);
assert.deepEqual(relevant, ["src/lib/format.ts", "scripts/runner-helper.ts"]);
assert.deepEqual(runnerRelevantChanges(["docs/notes.md"], closure), []);

assert.equal(resolveSpecifier("scripts/agent-runner.ts", "./missing", io), null);
assert.equal(resolveSpecifier("scripts/agent-runner.ts", "pg", io), null);
assert.equal(resolveSpecifier("src/lib/format.ts", "./db/query", io), "src/lib/db/query.ts");
