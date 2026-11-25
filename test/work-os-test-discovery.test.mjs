import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MANUAL_E2E_TESTS,
  SITE_TESTS,
  WINDOWS_ONLY_TESTS,
  discoverTestSuites,
  parseArgs,
  selectShard,
  selectSuiteFiles,
} from "../scripts/run-work-os-tests.mjs";

test("every test file in test/ is classified into exactly one bucket with zero duplicates", () => {
  const suites = discoverTestSuites();
  const allClassified = [
    ...suites.core,
    ...suites.payroll,
    ...suites.site,
    ...suites.windowsOnly,
    ...suites.manualE2e,
  ];

  const unique = new Set(allClassified);
  assert.equal(unique.size, allClassified.length, "no test file may appear in multiple buckets");
  assert.deepEqual(
    [...unique].sort(),
    [...suites.discovered].sort(),
    "classified union must match every *.test.{mjs,mts} file in test/",
  );
  assert.ok(suites.core.includes("test/work-os-ai-model.test.mts"), "core includes work-os-ai-model once");
  assert.equal(
    suites.core.filter((file) => file === "test/work-os-ai-model.test.mts").length,
    1,
    "work-os-ai-model must not be duplicated",
  );
  assert.ok(suites.core.includes("test/work-os-migration.test.mjs"));
  assert.ok(suites.core.includes("test/work-os-companion-release-gate.test.mjs"));
  assert.ok(suites.core.includes("test/work-os-task-finder.test.mts"));
  assert.ok(suites.site.includes("test/work-os-social-preview.test.mts"));
  assert.ok(suites.payroll.length > 0, "payroll suite discovers payroll tests");
  assert.deepEqual(suites.windowsOnly, [...WINDOWS_ONLY_TESTS]);
  assert.deepEqual(suites.manualE2e, [...MANUAL_E2E_TESTS]);
  assert.equal(suites.site.length, SITE_TESTS.length);
});

test("sharding partitions a suite deterministically with complete coverage and zero overlap", () => {
  const files = selectSuiteFiles("work-os");
  const shard1 = selectShard(files, "1/3");
  const shard2 = selectShard(files, "2/3");
  const shard3 = selectShard(files, "3/3");

  const combined = [...shard1, ...shard2, ...shard3];
  assert.equal(new Set(combined).size, combined.length, "shards must not overlap");
  assert.deepEqual([...combined].sort(), [...files].sort(), "union of shards must equal full suite");
  assert.ok(Math.abs(shard1.length - shard3.length) <= 1, "shards stay evenly balanced");
  assert.throws(() => selectShard(files, "0/3"), /Invalid --shard/);
  assert.throws(() => selectShard(files, "4/3"), /Invalid --shard/);
  assert.throws(() => selectShard(files, "abc"), /Invalid --shard/);
});

test("CLI arg parser validates suites and concurrency", () => {
  assert.deepEqual(parseArgs([]), { suite: "work-os", shard: null, concurrency: null, list: false });
  assert.deepEqual(parseArgs(["--suite=site", "--shard=2/4", "--concurrency=3", "--list"]), {
    suite: "site",
    shard: "2/4",
    concurrency: 3,
    list: true,
  });
  assert.throws(() => parseArgs(["--concurrency=0"]), /Invalid --concurrency/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/);
  assert.throws(() => selectSuiteFiles("nope"), /Unknown --suite/);
});
