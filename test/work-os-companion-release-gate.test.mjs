import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

// A missing/always-true gate, premature reset, or identity reuse must fail these
// tests. Expectations use literal counts, not the implementation's constants.
const gate = await import("../scripts/work-os-companion-release-gate.mjs").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const update = (id, type = "feature") => ({ id, type, summary: `Employee outcome ${id}`, verification: `node --test test/${id}.test.mjs passed` });
const queue = (count = 0) => ({ schemaVersion: 1, updates: Array.from({ length: count }, (_, i) => update(`change-${i + 1}`)), emergency: null });
const evaluate = (current, extra = {}) => {
  assert.equal(typeof gate.evaluateRelease, "function", "release eligibility must have an enforcing gate");
  return gate.evaluateRelease({ queue: current, publishedQueue: queue(), version: "0.5.17", publishedVersion: "0.5.16", ...extra });
};

test("zero through four meaningful updates cannot release; five and six can", () => {
  for (const [count, eligible] of [[0, false], [1, false], [2, false], [3, false], [4, false], [5, true], [6, true]]) {
    const result = evaluate(queue(count));
    assert.equal(result.eligible, eligible, `pending=${count}`);
    assert.equal(result.pending.length, count);
    assert.equal(result.emergency, false);
  }
});

test("already published outcomes do not count toward the next five", () => {
  const result = evaluate(queue(6), { publishedQueue: queue(5), version: "0.5.18", publishedVersion: "0.5.17" });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.pending.map((entry) => entry.id), ["change-6"]);
});

test("a failed draft consumes nothing, and a successful snapshot resets only its own outcomes", () => {
  const current = queue(5);
  assert.equal(evaluate(current).eligible, true);
  assert.equal(evaluate(current).pending.length, 5); // Same published baseline on retry.
  const next = queue(6);
  assert.deepEqual(evaluate(next, { publishedQueue: current, publishedVersion: "0.5.17", version: "0.5.18" }).pending.map((entry) => entry.id), ["change-6"]);
  assert.equal(current.updates.length, 5, "the evaluator never clears the checked-in queue");
});

test("already published versions skip rather than rebuild, even with newly queued updates", () => {
  const result = evaluate(queue(6), { version: "0.5.17", publishedVersion: "0.5.17", publishedQueue: queue(5) });
  assert.equal(result.eligible, false);
  assert.equal(result.pending.length, 1);
});

test("a version bump cannot skip or roll back the next canonical patch", () => {
  for (const version of ["0.5.15", "0.5.18", "0.6.0", "0.5.017", "0.5.17-beta.1"]) {
    assert.throws(() => evaluate(queue(5), { version }), /version|patch/i);
  }
});

test("duplicate outcome IDs and duplicate summaries cannot inflate eligibility", () => {
  const duplicate = queue(5);
  duplicate.updates[4].id = "change-1";
  assert.throws(() => evaluate(duplicate), /duplicate/i);
  duplicate.updates[4].id = "change-5";
  duplicate.updates[4].summary = "  EMPLOYEE outcome change-1  ";
  assert.throws(() => evaluate(duplicate), /duplicate/i);
});

test("consumed outcomes cannot be removed, renamed, or edited to count again", () => {
  const previous = queue(1);
  for (const mutate of [
    (current) => current.updates.shift(),
    (current) => { current.updates[0].id = "renamed-change"; },
    (current) => { current.updates[0].summary = "Renamed outcome"; },
    (current) => { current.updates[0].verification = "different verification"; },
  ]) {
    const current = queue(6);
    mutate(current);
    assert.throws(() => evaluate(current, { publishedQueue: previous }), /append-only|immutable/i);
  }
});

test("empty, malformed, unverified, or internal-only outcomes fail closed", () => {
  for (const malformed of [null, {}, { ...queue(), schemaVersion: 2 }, { ...queue(), updates: null }]) {
    assert.throws(() => evaluate(malformed), /queue|schema/i);
  }
  for (const [field, value] of [["id", ""], ["summary", " "], ["verification", ""], ["type", "chore"]]) {
    const current = queue(5);
    current.updates[0][field] = value;
    assert.throws(() => evaluate(current), /update|outcome|verification/i);
  }
  assert.throws(() => evaluate(queue(5), { publishedQueue: null }), /queue/i);
});

const emergency = () => ({ version: "0.5.17", updateId: "change-1", brokenBehavior: "Installed app crashes before sign-in", restoredBehavior: "App opens and employees can sign in again" });

test("documented emergency fix may restore essential behavior before five updates", () => {
  const current = queue(1);
  current.updates[0].type = "fix";
  current.emergency = emergency();
  const result = evaluate(current);
  assert.equal(result.eligible, true);
  assert.equal(result.emergency, true);
  assert.equal(result.pending.length, 1);
});

test("emergencies cannot reuse old fixes, claim features, omit impact, or leak to another version", () => {
  for (const change of [
    (current) => { current.emergency.version = "0.5.18"; },
    (current) => { current.emergency.updateId = "missing-fix"; },
    (current) => { current.emergency.brokenBehavior = " "; },
    (current) => { current.emergency.restoredBehavior = ""; },
    (current) => { current.updates[0].type = "feature"; },
  ]) {
    const current = queue(1);
    current.updates[0].type = "fix";
    current.emergency = emergency();
    change(current);
    assert.throws(() => evaluate(current), /emergency/i);
  }
  const current = queue(1);
  current.updates[0].type = "fix";
  current.emergency = emergency();
  assert.throws(() => evaluate(current, { publishedQueue: structuredClone(current) }), /emergency/i);
});

const override = () => ({ version: "0.5.17", updateId: "change-1", approvedBy: "operator", reason: "Explicit operator request to publish this outcome ahead of the cadence", approvedAt: "2026-11-09" });

test("a documented operator override may publish one pending outcome once", () => {
  const current = queue(1);
  current.operatorOverride = override();
  const result = evaluate(current);
  assert.equal(result.eligible, true);
  assert.equal(result.operatorOverride, true);
  assert.equal(result.emergency, false);
  assert.equal(result.pending.length, 1);
  assert.equal(evaluate(queue(1)).eligible, false, "an override is never implicit");
});

test("operator overrides are version- and outcome-scoped and need an approver, reason and date", () => {
  const future = queue(1);
  future.operatorOverride = override();
  future.operatorOverride.version = "0.5.18";
  assert.equal(evaluate(future).eligible, false, "a stale override cannot authorize a later version");
  for (const change of [
    (current) => { current.operatorOverride.updateId = "missing-change"; },
    (current) => { current.operatorOverride.approvedBy = " "; },
    (current) => { current.operatorOverride.reason = ""; },
    (current) => { current.operatorOverride.approvedAt = "yesterday"; },
  ]) {
    const current = queue(1);
    current.operatorOverride = override();
    change(current);
    assert.throws(() => evaluate(current), /override|approval|version|pending/i);
  }
});

test("published-release selection reads every page, ignores drafts, and orders canonical versions", () => {
  assert.equal(typeof gate.latestPublishedRelease, "function", "published history must be authoritative");
  const release = (version, more = {}) => ({ tag_name: `work-os-companion-internal-v${version}`, draft: false, published_at: "2026-10-30T00:00:00Z", ...more });
  assert.equal(gate.latestPublishedRelease([
    [release("0.5.18", { draft: true }), release("0.5.9"), release("0.5.17", { published_at: null })],
    [release("0.5.16"), release("0.5.15"), { ...release("99.0.0"), tag_name: "unrelated-v99.0.0" }],
  ]).version, "0.5.16");
  assert.throws(() => gate.latestPublishedRelease([]), /published/i);
  assert.throws(() => gate.latestPublishedRelease({}), /catalog/i);
});

const script = fileURLToPath(new URL("../scripts/work-os-companion-release-gate.mjs", import.meta.url));
const queuePath = "desktop/work-os-companion/release-queue.json";
function repository(t, count = 5, version = "0.5.17") {
  const root = mkdtempSync(join(tmpdir(), "companion-release-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release gate test");
  git("config", "user.email", "release-test@example.invalid");
  // The external provider is a process boundary; Git operations and snapshots
  // are real. Only GH API transport is replaced, never the gate's decisions.
  const provider = join(root, ".git", "provider.json");
  const bin = join(root, ".git", "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!${process.execPath}\nimport fs from 'node:fs';
const data = JSON.parse(fs.readFileSync(process.env.TEST_PROVIDER, 'utf8'));
const args = process.argv.slice(2);
if (data.fail) { console.error('provider unavailable'); process.exit(1); }
if (args[0] !== 'api') process.exit(2);
if (args[1].includes('/releases?')) {
  if (!args.includes('--paginate') || !args.includes('--slurp')) process.exit(3);
  console.log(JSON.stringify(data.pages));
} else if (args[1].includes('/contents/')) {
  if (!data.snapshot) { console.error('snapshot missing'); process.exit(4); }
  console.log(JSON.stringify({encoding:'base64',content:Buffer.from(JSON.stringify(data.snapshot)).toString('base64')}));
} else if (args[1].includes('/commits/')) {
  console.log(JSON.stringify({sha:data.tagCommit}));
} else process.exit(5);
`, { mode: 0o755 });
  const published = (v = "0.5.16", draft = false) => ({ tag_name: `work-os-companion-internal-v${v}`, draft, published_at: draft ? null : "2026-10-30T00:00:00Z" });
  const setProvider = (data = {}) => writeFileSync(provider, JSON.stringify({ pages: [[published()]], ...data }));
  setProvider();
  write("desktop/work-os-companion/package.json", { version: "0.5.16" });
  git("add", ".");
  git("commit", "-m", "published pre-policy baseline");
  git("tag", "work-os-companion-internal-v0.5.16");
  write(queuePath, queue(count));
  write("desktop/work-os-companion/package.json", { version });
  write("desktop/work-os-companion/src-tauri/tauri.conf.json", { version });
  write("desktop/work-os-companion/src-tauri/Cargo.toml", `[package]\nname = "fixture"\nversion = "${version}"\n`);
  write("desktop/work-os-companion/CHANGELOG.md", `# Changes\n\n## Unreleased\n\n## ${version} — 2026-10-30\n\n- Employee outcome.\n`);
  const commit = () => { git("add", "."); git("commit", "-m", "completed companion updates"); };
  commit();
  git("remote", "add", "origin", root);
  const output = join(root, ".git", "outputs");
  const run = (command = "check", env = {}) => {
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, [script, command], { cwd: root, encoding: "utf8", env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_PROVIDER: provider,
      GITHUB_REPOSITORY: "WrazyAI/work-os", GITHUB_OUTPUT: output,
      GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_REF_NAME: "main",
      GITHUB_RUN_ATTEMPT: "1",
      DISPATCH_VERSION: "", ...env,
    } });
    return { ...result, output: readFileSync(output, "utf8") };
  };
  return { root, git, write, commit, run, setProvider, published };
}

test("CLI blocks four, permits five, and never mutates version or queue files", (t) => {
  const blocked = repository(t, 4);
  const before = readFileSync(join(blocked.root, queuePath), "utf8");
  const result = blocked.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /eligible=false\n/);
  assert.equal(readFileSync(join(blocked.root, queuePath), "utf8"), before);
  assert.equal(blocked.git("status", "--porcelain"), "");
  const ready = repository(t, 5).run();
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.output, /eligible=true\n/);
  assert.match(ready.output, /version=0.5.17\n/);
});

test("CLI status reports the unbumped queue and does not allocate a release", (t) => {
  const fixture = repository(t, 4, "0.5.16");
  const result = fixture.run("status");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).pendingCount, 4);
  assert.equal(JSON.parse(result.stdout).eligible, false);
  assert.equal(result.output, "");
});

test("unbumped metadata skips packaging even though its published tag precedes queued work", (t) => {
  const fixture = repository(t, 4, "0.5.16");
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /eligible=false\n/);
});

test("CLI manual and tag entries enforce the same threshold and metadata", (t) => {
  const fixture = repository(t, 4);
  for (const env of [
    { GITHUB_EVENT_NAME: "workflow_dispatch", DISPATCH_VERSION: "0.5.17" },
    { GITHUB_REF: "refs/tags/work-os-companion-internal-v0.5.17", GITHUB_REF_NAME: "work-os-companion-internal-v0.5.17" },
  ]) {
    const result = fixture.run("check", env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.output, /eligible=false\n/);
  }
  for (const env of [
    { GITHUB_EVENT_NAME: "workflow_dispatch", DISPATCH_VERSION: "0.5.18" },
    { GITHUB_EVENT_NAME: "workflow_dispatch", DISPATCH_VERSION: "0.5.17", GITHUB_REF: "refs/heads/other" },
    { GITHUB_REF: "refs/tags/work-os-companion-internal-v0.5.18", GITHUB_REF_NAME: "work-os-companion-internal-v0.5.18" },
    { GITHUB_EVENT_NAME: "pull_request" },
  ]) {
    const result = fixture.run("check", env);
    assert.notEqual(result.status, 0);
    assert.equal(result.output, "");
  }
});

test("CLI rejects unsynchronized metadata and missing dated release notes before eligibility outputs", (t) => {
  for (const [path, contents] of [
    ["desktop/work-os-companion/src-tauri/tauri.conf.json", { version: "0.5.18" }],
    ["desktop/work-os-companion/src-tauri/Cargo.toml", '[package]\nversion = "0.5.18"\n'],
    ["desktop/work-os-companion/CHANGELOG.md", "# Changes\n\n## Unreleased\n\n- Not released yet.\n"],
  ]) {
    const fixture = repository(t);
    fixture.write(path, contents);
    fixture.commit();
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /version|changelog/i);
    assert.equal(result.output, "");
  }
});

test("CLI fails closed on provider failure and a missing post-policy release snapshot", (t) => {
  const fixture = repository(t);
  for (const provider of [{ fail: true }, { pages: [[fixture.published("0.5.17")]] }]) {
    fixture.setProvider(provider);
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.equal(result.output, "");
  }
});

test("CLI counts only published snapshots across pages, not a newer draft", (t) => {
  const fixture = repository(t, 6, "0.5.18");
  fixture.setProvider({ pages: [[fixture.published("0.5.18", true)], [fixture.published("0.5.17")]], snapshot: queue(5) });
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).pendingCount, 1);
  assert.match(result.output, /eligible=false\n/);
});

test("the already in-flight pre-policy 0.5.17 batch is consumed only after its pinned source publishes", (t) => {
  const fixture = repository(t, 0, "0.5.17");
  const initial = JSON.parse(readFileSync(new URL("../desktop/work-os-companion/release-baselines/0.5.17.json", import.meta.url), "utf8")).queue;
  fixture.write(queuePath, initial);
  fixture.commit();
  const before = fixture.run("status");
  assert.equal(before.status, 0, before.stderr);
  assert.equal(JSON.parse(before.stdout).pendingCount, 4);
  const source = "eb1784f50b3453ca39e499b3b2ae867af159547b";
  fixture.setProvider({ pages: [[{ ...fixture.published("0.5.17"), target_commitish: source }]], tagCommit: source });
  const after = fixture.run("status");
  assert.equal(after.status, 0, after.stderr);
  assert.equal(JSON.parse(after.stdout).pendingCount, 0);
  assert.equal(JSON.parse(after.stdout).eligible, false);
  fixture.setProvider({ pages: [[{ ...fixture.published("0.5.17"), target_commitish: source }]], tagCommit: "different-commit" });
  assert.notEqual(fixture.run("status").status, 0, "a recreated/moved tag cannot claim the legacy snapshot");
});

test("the published pre-policy 0.5.18 snapshot consumes the initial four outcomes", (t) => {
  const fixture = repository(t, 0, "0.5.18");
  const initial = JSON.parse(readFileSync(new URL("../desktop/work-os-companion/release-baselines/0.5.18.json", import.meta.url), "utf8")).queue;
  fixture.write(queuePath, initial);
  fixture.commit();
  const source = "a545e518e4cd33a9151c5d45fe9b53c5fd610b55";
  fixture.setProvider({ pages: [[{ ...fixture.published("0.5.18"), target_commitish: source }]], tagCommit: source });
  const result = fixture.run("status");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.version, "0.5.18");
  assert.equal(output.publishedVersion, "0.5.18");
  assert.equal(output.pendingCount, 0);
  assert.equal(output.eligible, false);
  fixture.setProvider({ pages: [[{ ...fixture.published("0.5.18"), target_commitish: source }]], tagCommit: "different-commit" });
  assert.notEqual(fixture.run("status").status, 0, "a recreated/moved tag cannot claim the legacy snapshot");
});

test("CLI rejects source commits outside main and unpublished queue entries removed from history", (t) => {
  const outside = repository(t);
  outside.git("checkout", "-b", "unmerged");
  outside.write("unmerged.txt", "unmerged");
  outside.commit();
  const unmerged = outside.run();
  assert.notEqual(unmerged.status, 0);
  assert.match(unmerged.stderr, /main/i);
  assert.equal(unmerged.output, "");

  const rewritten = repository(t, 6);
  rewritten.write(queuePath, { ...queue(6), updates: queue(6).updates.slice(1) });
  rewritten.commit();
  const missing = rewritten.run();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /append-only|immutable/i);
});

test("CLI final verification rejects a repeat publication and preserves failed batches", (t) => {
  const fixture = repository(t);
  assert.equal(fixture.run("verify").status, 0);
  assert.equal(fixture.run("verify").status, 0);
  fixture.setProvider({ pages: [[fixture.published("0.5.17")]], snapshot: queue(5) });
  const preflight = fixture.run();
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.match(preflight.output, /eligible=false\n/);
  const finalized = fixture.run("verify");
  assert.notEqual(finalized.status, 0);
  assert.equal(finalized.output, "");
});

test("CLI rejects stale bare release tags before packaging and publication", (t) => {
  const fixture = repository(t);
  fixture.git("tag", "work-os-companion-internal-v0.5.17", "work-os-companion-internal-v0.5.16");
  for (const mode of ["check", "verify"]) {
    const result = fixture.run(mode);
    assert.notEqual(result.status, 0, "assets and consumed queue must come from the tagged commit");
    assert.match(result.stderr, /tag.*commit/i);
    assert.equal(result.output, "");
  }
});

test("CLI accepts lightweight and annotated candidate tags only at the source commit", (t) => {
  for (const annotated of [false, true]) {
    const fixture = repository(t);
    fixture.git("tag", ...(annotated ? ["-a", "-m", "verified release source"] : []), "work-os-companion-internal-v0.5.17");
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.output, /eligible=true\n/);
  }
});

test("retries require a fresh dispatch instead of reuse of an old successful preflight", (t) => {
  const fixture = repository(t);
  const retry = fixture.run("check", { GITHUB_RUN_ATTEMPT: "2" });
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /fresh.*dispatch/i);
  assert.equal(retry.output, "");
});

test("cached successful preflight cannot allocate paid jobs on a failed-job rerun", () => {
  const yaml = createRequire(import.meta.url)("js-yaml");
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/work-os-companion-windows.yml", import.meta.url), "utf8"));
  for (const name of ["unsigned-windows-release", "unsigned-macos-release", "finalize-release"]) {
    const condition = workflow.jobs[name].if ?? "true";
    const context = { github: { run_attempt: 2 }, needs: { "release-gate": { outputs: { eligible: "true" } } } };
    // GitHub job conditions here use the same boolean/comparison operators.
    // Even when a successful gate is cached, no paid retry job may allocate.
    const expression = condition.replaceAll("needs.release-gate", 'needs["release-gate"]');
    assert.equal(runInNewContext(expression, context), false, `${name} must reject cached eligibility on attempt two`);
    context.github.run_attempt = 1;
    assert.equal(runInNewContext(expression, context), true, `${name} must allow a fresh eligible attempt`);
  }
});

test("paid packaging depends on the Linux gate and publication rechecks eligibility", () => {
  const require = createRequire(import.meta.url);
  const yaml = require("js-yaml");
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/work-os-companion-windows.yml", import.meta.url), "utf8"));
  const preflight = workflow.jobs["release-gate"];
  assert.ok(preflight, "a gate must exist before paid packaging");
  assert.equal(preflight["runs-on"], "ubuntu-24.04");
  assert.equal(workflow.jobs["unsigned-windows-release"].needs, "release-gate");
  assert.ok(workflow.jobs["unsigned-windows-release"].if.includes("needs.release-gate.outputs.eligible == 'true'"));
  assert.ok(preflight.steps.some((step) => step.run?.includes("work-os-companion-release-gate.mjs check")));
  const finalize = workflow.jobs["finalize-release"].steps;
  const checkIndex = finalize.findIndex((step) => step.run?.includes("work-os-companion-release-gate.mjs verify"));
  const publishIndex = finalize.findIndex((step) => step.run?.includes("--draft=false"));
  assert.ok(checkIndex >= 0 && checkIndex < publishIndex);
});
