#!/usr/bin/env node
/**
 * Auto-discovers and runs Work OS test suites under `test/`.
 *
 * Every `test/*.test.{mjs,mts}` file is classified into exactly one bucket:
 *   - `site`         public site, tutorials, film & social-preview checks
 *   - `payroll`      `test/work-os-payroll-*.test.{mjs,mts}`
 *   - `windows-only` PowerShell/Windows CI guards (excluded on Linux/macOS)
 *   - `manual-e2e`   tests requiring a live dev server (e.g. MEMORY_PREVIEW_URL)
 *   - `core`         every other `test/*.test.{mjs,mts}` file
 *
 * Because `core` and `payroll` use filesystem discovery rather than a manual
 * filename list, newly added test files can never be silently omitted from CI.
 *
 * Usage:
 *   node scripts/run-work-os-tests.mjs --suite=work-os [--shard=1/3] [--concurrency=4]
 *   node scripts/run-work-os-tests.mjs --suite=core|payroll|site|all [--list]
 */

import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SITE_TESTS = Object.freeze([
  "test/landing-public-routes.test.mts",
  "test/work-os-companion-site.test.mts",
  "test/work-os-download-guides.test.mts",
  "test/work-os-film-production.test.mts",
  "test/work-os-installer-downloads.test.mts",
  "test/work-os-landing-routes.test.mts",
  "test/work-os-offline-clock.test.mts",
  "test/work-os-offline-filming-boot.test.mts",
  "test/work-os-otto-film.test.mts",
  "test/work-os-otto-publication.test.mts",
  "test/work-os-social-preview.test.mts",
  "test/work-os-tutorial-chapters.test.mts",
  "test/work-os-tutorial-library.test.mts",
  "test/work-os-tutorial-media.test.mts",
  "test/work-os-tutorial-player-focus.test.mts",
  "test/work-os-welcome-page.test.mts",
  "test/work-os-welcome-routes.test.mts",
]);

/** Run on Windows CI (`windows-2025` release-policy job). */
export const WINDOWS_ONLY_TESTS = Object.freeze([
  "test/work-os-release-policy.test.mjs",
]);

/** Require a live Vite dev server (run explicitly with MEMORY_PREVIEW_URL). */
export const MANUAL_E2E_TESTS = Object.freeze([
  "test/work-os-memory-interaction.test.mjs",
]);

const PAYROLL_PATTERN = /^test\/work-os-payroll-.*\.test\.m[jt]s$/;
const TEST_FILE_PATTERN = /\.test\.m[jt]s$/;

export function discoverTestSuites(rootDir = REPO_ROOT) {
  const testDir = path.join(rootDir, "test");
  const discovered = readdirSync(testDir)
    .filter((name) => TEST_FILE_PATTERN.test(name))
    .map((name) => `test/${name}`)
    .sort();

  const discoveredSet = new Set(discovered);
  const manifestGroups = [
    ["site", SITE_TESTS],
    ["windows-only", WINDOWS_ONLY_TESTS],
    ["manual-e2e", MANUAL_E2E_TESTS],
  ];

  const seenManifest = new Set();
  for (const [groupName, entries] of manifestGroups) {
    for (const file of entries) {
      if (!discoveredSet.has(file)) {
        throw new Error(`Test manifest (${groupName}) references missing file: ${file}`);
      }
      if (seenManifest.has(file)) {
        throw new Error(`Test manifest lists file in multiple groups: ${file}`);
      }
      seenManifest.add(file);
    }
  }

  const siteSet = new Set(SITE_TESTS);
  const excludedSet = new Set([...WINDOWS_ONLY_TESTS, ...MANUAL_E2E_TESTS]);

  const site = discovered.filter((file) => siteSet.has(file));
  const payroll = discovered.filter((file) => !siteSet.has(file) && !excludedSet.has(file) && PAYROLL_PATTERN.test(file));
  const core = discovered.filter((file) => !siteSet.has(file) && !excludedSet.has(file) && !PAYROLL_PATTERN.test(file));
  const workOs = [...core, ...payroll];

  return {
    discovered,
    core,
    payroll,
    site,
    workOs,
    windowsOnly: [...WINDOWS_ONLY_TESTS],
    manualE2e: [...MANUAL_E2E_TESTS],
  };
}

export function selectSuiteFiles(suite, suites = discoverTestSuites()) {
  switch (suite) {
    case "work-os": return suites.workOs;
    case "core": return suites.core;
    case "payroll": return suites.payroll;
    case "site": return suites.site;
    case "all": return [...suites.core, ...suites.payroll, ...suites.site];
    default:
      throw new Error(`Unknown --suite "${suite}". Expected one of: work-os, core, payroll, site, all.`);
  }
}

export function selectShard(files, shardSpec) {
  if (!shardSpec) return files;
  const match = String(shardSpec).match(/^(\d+)\/(\d+)$/);
  if (!match) throw new Error(`Invalid --shard "${shardSpec}". Expected "<index>/<total>", e.g. 1/3.`);
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || index < 1 || index > total) {
    throw new Error(`Invalid --shard "${shardSpec}". Index must be between 1 and total.`);
  }
  return files.filter((_, i) => (i % total) === (index - 1));
}

export function parseArgs(argv) {
  const options = {
    suite: "work-os",
    shard: null,
    concurrency: null,
    list: false,
  };
  for (const arg of argv) {
    if (arg === "--list") {
      options.list = true;
    } else if (arg.startsWith("--suite=")) {
      options.suite = arg.slice("--suite=".length);
    } else if (arg.startsWith("--shard=")) {
      options.shard = arg.slice("--shard=".length);
    } else if (arg.startsWith("--concurrency=")) {
      const value = Number(arg.slice("--concurrency=".length));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`Invalid --concurrency "${arg}". Expected a positive integer.`);
      }
      options.concurrency = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function defaultConcurrency() {
  const envValue = Number(process.env.WORK_OS_TEST_CONCURRENCY ?? "");
  if (Number.isInteger(envValue) && envValue > 0) return envValue;
  const cpus = typeof availableParallelism === "function" ? availableParallelism() : 4;
  return Math.max(2, Math.min(cpus - 1, 6));
}

function runNodeTest(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (signal) resolvePromise(1);
      else resolvePromise(code ?? 1);
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const suites = discoverTestSuites(REPO_ROOT);
  const selected = selectShard(selectSuiteFiles(options.suite, suites), options.shard);

  if (options.list) {
    for (const file of selected) console.log(file);
    return;
  }

  if (selected.length === 0) {
    console.log(`No test files selected for suite="${options.suite}"${options.shard ? ` shard=${options.shard}` : ""}.`);
    return;
  }

  const concurrency = options.concurrency ?? defaultConcurrency();
  const mjsFiles = selected.filter((file) => file.endsWith(".mjs"));
  const mtsFiles = selected.filter((file) => file.endsWith(".mts"));

  console.log(
    `[work-os:test] suite=${options.suite}${options.shard ? ` shard=${options.shard}` : ""} files=${selected.length} (mjs=${mjsFiles.length}, mts=${mtsFiles.length}) concurrency=${concurrency}`,
  );

  if (mjsFiles.length > 0) {
    const code = await runNodeTest(["--test", `--test-concurrency=${concurrency}`, ...mjsFiles]);
    if (code !== 0) process.exit(code);
  }

  if (mtsFiles.length > 0) {
    const code = await runNodeTest(["--import", "tsx", "--test", `--test-concurrency=${concurrency}`, ...mtsFiles]);
    if (code !== 0) process.exit(code);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
