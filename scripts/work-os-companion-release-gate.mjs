#!/usr/bin/env node
import { canonicalTagVersion, releaseDisplayVersion } from "../desktop/work-os-companion/scripts/macos-release.mjs";
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const QUEUE_PATH = "desktop/work-os-companion/release-queue.json";
export const INITIAL_VERSION = "0.5.16";
const THRESHOLD = 5;

function parts(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Release version must be canonical stable SemVer");
  }
  const result = version.split(".").map(Number);
  if (!result.every(Number.isSafeInteger)) throw new Error("Release version is out of range");
  return result;
}

function compare(a, b) {
  const left = parts(a);
  const right = parts(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function text(value, max = 500) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\r\n\0]/.test(value);
}

function validateQueue(queue) {
  if (!queue || queue.schemaVersion !== 1 || !Array.isArray(queue.updates)) throw new Error("Invalid release queue schema");
  const ids = new Set();
  const summaries = new Set();
  for (const entry of queue.updates) {
    if (!entry || !text(entry.id, 100) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)
      || !["feature", "fix"].includes(entry.type) || !text(entry.summary, 200) || !text(entry.verification)) {
      throw new Error("Each update needs a stable ID, feature/fix type, outcome summary and verification");
    }
    const summary = entry.summary.trim().toLowerCase();
    if (ids.has(entry.id) || summaries.has(summary)) throw new Error("Duplicate update ID or outcome summary");
    ids.add(entry.id);
    summaries.add(summary);
  }
  return queue;
}

function identity(entry) {
  return JSON.stringify([entry.id, entry.type, entry.summary, entry.verification]);
}

export function evaluateRelease({ queue, publishedQueue, version, publishedVersion }) {
  validateQueue(queue);
  validateQueue(publishedQueue);
  parts(version);
  const previous = parts(publishedVersion);
  const current = new Map(queue.updates.map((entry) => [entry.id, entry]));
  for (const entry of publishedQueue.updates) {
    if (!current.has(entry.id) || identity(current.get(entry.id)) !== identity(entry)) {
      throw new Error(`Release queue is append-only; published outcome ${entry.id} is immutable`);
    }
  }
  const consumed = new Set(publishedQueue.updates.map((entry) => entry.id));
  const pending = queue.updates.filter((entry) => !consumed.has(entry.id));
  if (version === publishedVersion) return { eligible: false, pending, emergency: false };
  if (version !== `${previous[0]}.${previous[1]}.${previous[2] + 1}`) throw new Error("Release version must be the next patch after the latest published release");

  let emergency = false;
  if (queue.emergency !== null && queue.emergency !== undefined) {
    const record = queue.emergency;
    if (record.version !== version || !text(record.brokenBehavior) || !text(record.restoredBehavior)
      || !pending.some((entry) => entry.id === record.updateId && entry.type === "fix")) {
      throw new Error("Emergency must name this version, a pending fix, the broken essential behavior and its restoration");
    }
    emergency = true;
  }
  return { eligible: pending.length >= THRESHOLD || emergency, pending, emergency };
}

export function latestPublishedRelease(pages) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error("Invalid release catalog pages");
  const releases = [];
  for (const release of pages.flat()) {
    if (!release || release.draft !== false || !release.published_at || !release.tag_name?.startsWith("work-os-companion-internal-v")) continue;
    // Historical pre-release SemVers are not the stable companion release line.
    let version;
    try {
      version = canonicalTagVersion(release.tag_name);
      parts(version);
    } catch { continue; }
    releases.push({ ...release, version });
  }
  releases.sort((a, b) => compare(b.version, a.version));
  if (!releases.length) throw new Error("No published internal companion release found");
  if (releases[1]?.version === releases[0].version) throw new Error("Ambiguous published release version");
  return releases[0];
}

function command(binary, args) {
  try {
    return execFileSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch {
    // Never print provider output: local Git/CLI failures can contain credentials.
    throw new Error(`${binary} ${args[0]} failed; release state could not be verified`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertAppendOnly(before, after) {
  const entries = new Map(validateQueue(after).updates.map((entry) => [entry.id, identity(entry)]));
  for (const entry of validateQueue(before).updates) {
    if (entries.get(entry.id) !== identity(entry)) throw new Error(`Release queue is append-only; outcome ${entry.id} is immutable`);
  }
}

function checkHistory(queue) {
  let previous = { schemaVersion: 1, updates: [] };
  // Check main's successive snapshots, including still-unpublished outcomes.
  // A release never needs to delete queue entries or write a reset commit.
  const commits = command("git", ["rev-list", "--first-parent", "--reverse", "HEAD", "--", QUEUE_PATH]).split("\n").filter(Boolean);
  for (const commit of commits) {
    const snapshot = JSON.parse(command("git", ["show", `${commit}:${QUEUE_PATH}`]));
    assertAppendOnly(previous, snapshot);
    previous = snapshot;
  }
  assertAppendOnly(previous, queue);
}

function metadataVersion() {
  const directory = "desktop/work-os-companion";
  const version = readJson(`${directory}/package.json`).version;
  const tauri = readJson(`${directory}/src-tauri/tauri.conf.json`).version;
  const cargo = readFileSync(`${directory}/src-tauri/Cargo.toml`, "utf8")
    .match(/^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1]
    .match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  parts(version);
  if (tauri !== version || cargo !== version) throw new Error("Companion metadata versions disagree");
  return version;
}

function checkChangelog(version) {
  const changelog = readFileSync("desktop/work-os-companion/CHANGELOG.md", "utf8").replaceAll("\r\n", "\n");
  const escaped = version.replaceAll(".", "\\.");
  const section = changelog.match(new RegExp(`^## ${escaped} — \\d{4}-\\d{2}-\\d{2}\\s*\\n([\\s\\S]*?)(?=^##? |$(?![\\s\\S]))`, "m"));
  if (!section || !/^\s*[-*]\s+\S/m.test(section[1])) throw new Error("Release changelog needs a dated version section with employee-facing notes");
}

function checkSource(version) {
  if (process.env.GITHUB_RUN_ATTEMPT && process.env.GITHUB_RUN_ATTEMPT !== "1") {
    throw new Error("Release retries require a fresh workflow dispatch, not re-run jobs with cached eligibility");
  }
  const event = process.env.GITHUB_EVENT_NAME;
  const ref = process.env.GITHUB_REF;
  if (event === "workflow_dispatch") {
    if (ref !== "refs/heads/main" || process.env.DISPATCH_VERSION?.trim() !== version) {
      throw new Error("Manual releases must use main and the committed version");
    }
  } else if (event === "push") {
    if (ref?.startsWith("refs/tags/work-os-companion-internal-v")) {
      if (canonicalTagVersion(ref.slice("refs/tags/".length)) !== version) throw new Error("Release tag version disagrees with metadata");
    } else if (ref !== "refs/heads/main") {
      throw new Error("Release push must originate from main or its internal release tag");
    }
  } else {
    throw new Error("Unsupported release event");
  }
  command("git", ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  try {
    command("git", ["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"]);
  } catch {
    throw new Error("Release source must already be merged into main");
  }
  if (command("git", ["status", "--porcelain", "--untracked-files=no"])) throw new Error("Release source has uncommitted changes");
}

function checkCandidateTag(version) {
  const tag = `refs/tags/work-os-companion-internal-v${releaseDisplayVersion(version)}`;
  const refs = command("git", ["ls-remote", "--tags", "origin", tag, `${tag}^{}`])
    .split("\n").filter(Boolean).map((line) => line.split(/\s+/));
  const target = refs.find(([, ref]) => ref === `${tag}^{}`) ?? refs.find(([, ref]) => ref === tag);
  if (target && target[0] !== command("git", ["rev-parse", "HEAD"])) {
    throw new Error("Existing candidate release tag points to a different commit; reconcile it before packaging or publication");
  }
}

function publishedSnapshot(repository, release) {
  // This is the one pre-policy release. No other read failure can initialize
  // empty state, or a provider outage could make consumed updates count twice.
  if (release.version === INITIAL_VERSION) return { schemaVersion: 1, updates: [], emergency: null };
  if (compare(release.version, INITIAL_VERSION) < 0) throw new Error("Published release is older than the policy baseline");
  const response = JSON.parse(command("gh", ["api", `repos/${repository}/contents/${QUEUE_PATH}?ref=${encodeURIComponent(release.tag_name)}`]));
  if (response.encoding !== "base64" || typeof response.content !== "string") throw new Error("Published release queue snapshot is missing");
  return validateQueue(JSON.parse(Buffer.from(response.content, "base64").toString("utf8")));
}

function main() {
  const mode = process.argv[2];
  if (!["status", "check", "verify"].includes(mode) || process.argv.length !== 3) throw new Error("Usage: node scripts/work-os-companion-release-gate.mjs status|check|verify");
  const repository = process.env.GITHUB_REPOSITORY || command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GitHub repository");
  const version = metadataVersion();
  if (mode !== "status") checkSource(version);
  const pages = JSON.parse(command("gh", ["api", `repos/${repository}/releases?per_page=100`, "--paginate", "--slurp"]));
  const published = latestPublishedRelease(pages);
  const queue = readJson(QUEUE_PATH);
  checkHistory(queue);
  const result = evaluateRelease({ queue, publishedQueue: publishedSnapshot(repository, published), version, publishedVersion: published.version });
  if (mode !== "status" && version !== published.version) {
    checkChangelog(version);
    checkCandidateTag(version);
  }
  if (mode === "verify" && !result.eligible) throw new Error("Release is no longer eligible: already published or fewer than five pending updates without an emergency fix");
  const output = { version, publishedVersion: published.version, pendingCount: result.pending.length, requiredUpdates: THRESHOLD,
    eligible: result.eligible, emergency: result.emergency, pending: result.pending };
  if (mode === "check" && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${result.eligible}\nversion=${version}\n`);
  }
  if (mode !== "status" && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Companion release gate\n\nPending updates: **${result.pending.length}/${THRESHOLD}**. Eligible: **${result.eligible}**. Emergency: **${result.emergency}**.\n`);
  }
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
