#!/usr/bin/env node
import {
  NIGHTLY_TAG_PREFIX,
  STABLE_TAG_PREFIX,
  canonicalTagVersion,
  parseReleaseTag,
  releaseAssetNames,
  releaseDisplayVersion,
  releaseTagName,
} from "../desktop/work-os-companion/scripts/macos-release.mjs";
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const QUEUE_PATH = "desktop/work-os-companion/release-queue.json";
export const INITIAL_VERSION = "0.5.16";
const THRESHOLD = 5;
// Verification records real commands and results, and a single outcome may need
// several suites plus rendered checks. 800 cut that evidence off; keep a bound
// so the queue stays evidence rather than unbounded prose.
const MAX_VERIFICATION = 1200;
const PRE_POLICY_BASELINES = new Map([
  ["0.5.17", "0.5.17.json"],
  ["0.5.18", "0.5.18.json"],
]);

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

function validateOperatorOverride(queue) {
  if (queue.operatorOverride === null || queue.operatorOverride === undefined) return null;
  const record = queue.operatorOverride;
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Operator override must be an object");
  if (!text(record.version, 20)) throw new Error("Operator override needs a version");
  parts(record.version);
  if (!text(record.updateId, 100)) throw new Error("Operator override needs a pending update ID");
  if (!text(record.approvedBy, 80) || !text(record.reason, 500)) {
    throw new Error("Operator override needs an approver and reason");
  }
  if (typeof record.approvedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.approvedAt)) {
    throw new Error("Operator override needs an approval date");
  }
  return record;
}

function validateQueue(queue) {
  if (!queue || queue.schemaVersion !== 1 || !Array.isArray(queue.updates)) throw new Error("Invalid release queue schema");
  const ids = new Set();
  const summaries = new Set();
  for (const entry of queue.updates) {
    if (!entry || !text(entry.id, 100) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)
      || !["feature", "fix"].includes(entry.type) || !text(entry.summary, 200) || !text(entry.verification, MAX_VERIFICATION)) {
      throw new Error("Each update needs a stable ID, feature/fix type, outcome summary and verification");
    }
    if (entry.macosSpecific !== undefined && typeof entry.macosSpecific !== "boolean") {
      throw new Error("Each update macosSpecific flag must be a boolean when provided");
    }
    const summary = entry.summary.trim().toLowerCase();
    if (ids.has(entry.id) || summaries.has(summary)) throw new Error("Duplicate update ID or outcome summary");
    ids.add(entry.id);
    summaries.add(summary);
  }
  validateOperatorOverride(queue);
  return queue;
}

function identity(entry) {
  return entry.macosSpecific === true
    ? JSON.stringify([entry.id, entry.type, entry.summary, entry.verification, true])
    : JSON.stringify([entry.id, entry.type, entry.summary, entry.verification]);
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
  const includeMacos = pending.some((entry) => entry.macosSpecific === true);
  if (version === publishedVersion) {
    return { eligible: false, pending, emergency: false, operatorOverride: false, includeMacos };
  }
  if (version !== `${previous[0]}.${previous[1]}.${previous[2] + 1}`) {
    throw new Error("Release version must be the next patch after the latest published release");
  }

  let operatorOverride = false;
  const override = queue.operatorOverride;
  if (override && override.version === version) {
    if (!pending.some((entry) => entry.id === override.updateId)) {
      throw new Error("Operator override must name a pending outcome for this version");
    }
    operatorOverride = true;
  }

  let emergency = false;
  if (queue.emergency !== null && queue.emergency !== undefined) {
    const record = queue.emergency;
    if (record.version !== version || !text(record.brokenBehavior) || !text(record.restoredBehavior)
      || !pending.some((entry) => entry.id === record.updateId && entry.type === "fix")) {
      throw new Error("Emergency must name this version, a pending fix, the broken essential behavior and its restoration");
    }
    emergency = true;
  }
  return {
    eligible: pending.length >= THRESHOLD || emergency || operatorOverride,
    pending,
    emergency,
    operatorOverride,
    includeMacos,
  };
}

export function hasMacosReleaseAssets(release) {
  const names = new Set((Array.isArray(release?.assets) ? release.assets : []).map((asset) => asset?.name));
  const { channel } = parseReleaseTag(release.tag_name);
  // Nightlies created before the channel-specific asset names used the Stable
  // names; accept either layout when deciding whether macOS already exists.
  const layouts = [releaseAssetNames(channel)];
  if (channel === "nightly") layouts.push(releaseAssetNames("stable"));
  return layouts.some((layout) => layout.macosAssets.every((file) => names.has(file)));
}

export function latestPublishedByChannel(pages) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Invalid release catalog pages");
  }
  const stable = [];
  const nightly = [];
  for (const release of pages.flat()) {
    if (!release || release.draft !== false || !release.published_at || typeof release.tag_name !== "string") continue;
    if (!release.tag_name.startsWith(STABLE_TAG_PREFIX) && !release.tag_name.startsWith(NIGHTLY_TAG_PREFIX)) continue;
    let parsed;
    try {
      parsed = parseReleaseTag(release.tag_name);
      parts(parsed.version);
    } catch { continue; }
    const item = { ...release, channel: parsed.channel, version: parsed.version };
    if (parsed.channel === "stable") stable.push(item);
    else nightly.push(item);
  }
  const sortDesc = (list) => {
    list.sort((a, b) => compare(b.version, a.version));
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].version === list[i - 1].version) throw new Error("Ambiguous published release version");
    }
    return list;
  };
  sortDesc(stable);
  sortDesc(nightly);
  const latestStable = stable[0] ?? null;
  const latestNightly = nightly[0] ?? null;
  let latest = null;
  if (latestStable && latestNightly) {
    latest = compare(latestNightly.version, latestStable.version) > 0 ? latestNightly : latestStable;
  } else {
    latest = latestStable ?? latestNightly;
  }
  if (!latest) throw new Error("No published internal companion release found");

  const unpromotedNightlies = nightly
    .filter((item) => !latestStable || compare(item.version, latestStable.version) > 0)
    .map((item) => ({
      version: item.version,
      displayVersion: releaseDisplayVersion(item.version),
      tag: item.tag_name,
      publishedAt: item.published_at,
      hasMacos: hasMacosReleaseAssets(item),
    }));

  return { latest, latestStable, latestNightly, stable, nightly, unpromotedNightlies };
}

export function latestPublishedRelease(pages) {
  return latestPublishedByChannel(pages).latest;
}

export function evaluatePromotion({ pages, version }) {
  parts(version);
  const catalog = latestPublishedByChannel(pages);
  const nightly = catalog.nightly.find((item) => item.version === version);
  if (!nightly) {
    throw new Error(`No published Nightly release found for version ${version}`);
  }
  if (catalog.stable.some((item) => item.version === version)) {
    throw new Error(`Version ${version} is already published on the Stable channel`);
  }
  if (catalog.latestStable && compare(version, catalog.latestStable.version) <= 0) {
    throw new Error(`Promotion target ${version} must be newer than current Stable ${catalog.latestStable.version}`);
  }
  const hasMacos = hasMacosReleaseAssets(nightly);
  return {
    eligible: true,
    version,
    displayVersion: releaseDisplayVersion(version),
    nightlyTag: nightly.tag_name,
    stableTag: releaseTagName(version, "stable"),
    previousStableVersion: catalog.latestStable?.version ?? null,
    targetCommitish: nightly.target_commitish ?? null,
    hasMacos,
    needsMacosBuild: !hasMacos,
  };
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

/** One-time repair for an unpublished outcome: PR #190 corrected the recorded
 * test count from 2,062 to 2,063 after the entry had been appended. The policy
 * forbids rewrites, so accept only that single verification-token correction
 * for that one outcome; every other identity change still fails closed. */
export function isAllowedVerificationCorrection(before, after) {
  if (before.id !== "shared-vault-single-initialization") return false;
  if (before.type !== after.type || before.summary !== after.summary) return false;
  const corrected = before.verification.replace(/\b2062\b/, "2063");
  return corrected !== before.verification && corrected === after.verification;
}

function assertAppendOnly(before, after) {
  const afterById = new Map(validateQueue(after).updates.map((entry) => [entry.id, entry]));
  for (const entry of validateQueue(before).updates) {
    const current = afterById.get(entry.id);
    if (current && identity(current) === identity(entry)) continue;
    if (current && isAllowedVerificationCorrection(entry, current)) continue;
    throw new Error(`Release queue is append-only; outcome ${entry.id} is immutable`);
  }
}

function checkHistory(queue) {
  let previous = { schemaVersion: 1, updates: [] };
  // Check main's successive snapshots, including still-unpublished outcomes.
  // A release never needs to delete queue entries or write a reset commit.
  const commits = command("git", ["rev-list", "--first-parent", "--reverse", "HEAD", "--", QUEUE_PATH]).split("\n").filter(Boolean);
  for (const commit of commits) {
    let snapshot;
    try {
      snapshot = JSON.parse(command("git", ["show", `${commit}:${QUEUE_PATH}`]));
    } catch {
      // An unparseable intermediate commit was never a valid queue snapshot
      // and cannot have been published. The current file and every published
      // snapshot are still validated before this check.
      continue;
    }
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
    if (ref?.startsWith(`refs/tags/${STABLE_TAG_PREFIX}`) || ref?.startsWith(`refs/tags/${NIGHTLY_TAG_PREFIX}`)) {
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
  const head = command("git", ["rev-parse", "HEAD"]);
  const display = releaseDisplayVersion(version);
  for (const prefix of [NIGHTLY_TAG_PREFIX, STABLE_TAG_PREFIX]) {
    const tag = `refs/tags/${prefix}${display}`;
    const refs = command("git", ["ls-remote", "--tags", "origin", tag, `${tag}^{}`])
      .split("\n").filter(Boolean).map((line) => line.split(/\s+/));
    const target = refs.find(([, ref]) => ref === `${tag}^{}`) ?? refs.find(([, ref]) => ref === tag);
    if (target && target[0] !== head) {
      throw new Error("Existing candidate release tag points to a different commit; reconcile it before packaging or publication");
    }
  }
}

function checkPromotionTag(stableTag, expectedCommit) {
  const tag = `refs/tags/${stableTag}`;
  const refs = command("git", ["ls-remote", "--tags", "origin", tag, `${tag}^{}`])
    .split("\n").filter(Boolean).map((line) => line.split(/\s+/));
  const target = refs.find(([, ref]) => ref === `${tag}^{}`) ?? refs.find(([, ref]) => ref === tag);
  if (target && target[0] !== expectedCommit) {
    throw new Error("Existing Stable release tag points to a different commit than the Nightly release; reconcile it before promotion");
  }
}

function publishedSnapshot(repository, release) {
  // 0.5.16 is the only pre-policy release with an empty historical queue.
  // 0.5.17 was cancelled, and 0.5.18 published the initial four outcomes before
  // this gate existed. Their tags cannot contain a queue, so each source-pinned
  // baseline supplies the snapshot instead of a provider read that would fail
  // closed. No other read failure can initialize empty state.
  if (release.version === INITIAL_VERSION) return { schemaVersion: 1, updates: [], emergency: null };
  if (compare(release.version, INITIAL_VERSION) < 0) throw new Error("Published release is older than the policy baseline");
  const baseline = PRE_POLICY_BASELINES.get(release.version);
  if (baseline) {
    const legacy = JSON.parse(readFileSync(new URL(`../desktop/work-os-companion/release-baselines/${baseline}`, import.meta.url), "utf8"));
    if (release.target_commitish === legacy.sourceCommit) {
      const tag = JSON.parse(command("gh", ["api", `repos/${repository}/commits/${encodeURIComponent(release.tag_name)}`]));
      if (tag.sha !== legacy.sourceCommit) throw new Error("Pre-policy release tag no longer matches its recorded source commit");
      return validateQueue(legacy.queue);
    }
  }
  const response = JSON.parse(command("gh", ["api", `repos/${repository}/contents/${QUEUE_PATH}?ref=${encodeURIComponent(release.tag_name)}`]));
  if (response.encoding !== "base64" || typeof response.content !== "string") throw new Error("Published release queue snapshot is missing");
  return validateQueue(JSON.parse(Buffer.from(response.content, "base64").toString("utf8")));
}

function runPromotionGate(mode, repository) {
  if (process.env.GITHUB_RUN_ATTEMPT && process.env.GITHUB_RUN_ATTEMPT !== "1") {
    throw new Error("Promotion retries require a fresh workflow dispatch, not re-run jobs with cached eligibility");
  }
  if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Stable promotion must run via manual workflow_dispatch on main");
  }
  const promoteVersion = process.env.PROMOTE_VERSION?.trim() ?? "";
  parts(promoteVersion);
  const pages = JSON.parse(command("gh", ["api", `repos/${repository}/releases?per_page=100`, "--paginate", "--slurp"]));
  const promotion = evaluatePromotion({ pages, version: promoteVersion });
  const tagCommit = JSON.parse(command("gh", ["api", `repos/${repository}/commits/${encodeURIComponent(promotion.nightlyTag)}`]));
  const sourceCommit = tagCommit?.sha;
  if (!sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error(`Could not resolve source commit for Nightly tag ${promotion.nightlyTag}`);
  }
  checkPromotionTag(promotion.stableTag, sourceCommit);
  const output = { ...promotion, sourceCommit };
  if (mode === "check-promote" && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `eligible=${output.eligible}`,
        `version=${output.version}`,
        `display_version=${output.displayVersion}`,
        `nightly_tag=${output.nightlyTag}`,
        `stable_tag=${output.stableTag}`,
        `previous_stable_version=${output.previousStableVersion ?? ""}`,
        `source_commit=${output.sourceCommit}`,
        `needs_macos_build=${output.needsMacosBuild}`,
      ].join("\n") + "\n",
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Stable promotion gate\n\nPromoting Nightly **${output.displayVersion}** (\`${output.nightlyTag}\`) to Stable (\`${output.stableTag}\`) from commit \`${output.sourceCommit.slice(0, 8)}\`. Previous Stable: **${output.previousStableVersion ?? "none"}**. Needs macOS build: **${output.needsMacosBuild}**.\n`,
    );
  }
  console.log(JSON.stringify(output, null, 2));
}

function main() {
  const mode = process.argv[2];
  if (!["status", "check", "verify", "check-promote", "verify-promote"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node scripts/work-os-companion-release-gate.mjs status|check|verify|check-promote|verify-promote");
  }
  const repository = process.env.GITHUB_REPOSITORY || command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GitHub repository");
  if (mode === "check-promote" || mode === "verify-promote") {
    runPromotionGate(mode, repository);
    return;
  }
  const version = metadataVersion();
  if (mode !== "status") checkSource(version);
  const pages = JSON.parse(command("gh", ["api", `repos/${repository}/releases?per_page=100`, "--paginate", "--slurp"]));
  const catalog = latestPublishedByChannel(pages);
  const published = catalog.latest;
  const queue = readJson(QUEUE_PATH);
  checkHistory(queue);
  const result = evaluateRelease({ queue, publishedQueue: publishedSnapshot(repository, published), version, publishedVersion: published.version });
  const forcedMacos = process.env.DISPATCH_INCLUDE_MACOS?.trim().toLowerCase() === "true";
  const includeMacos = result.includeMacos || forcedMacos;
  if (mode !== "status" && version !== published.version) {
    checkChangelog(version);
    checkCandidateTag(version);
  }
  if (mode === "verify" && !result.eligible) {
    throw new Error("Release is no longer eligible: already published or fewer than five pending updates without an emergency fix or operator override");
  }
  const output = {
    version,
    publishedVersion: published.version,
    publishedChannel: published.channel,
    latestStableVersion: catalog.latestStable?.version ?? null,
    latestNightlyVersion: catalog.latestNightly?.version ?? null,
    pendingCount: result.pending.length,
    requiredUpdates: THRESHOLD,
    eligible: result.eligible,
    includeMacos,
    emergency: result.emergency,
    operatorOverride: result.operatorOverride,
    pending: result.pending,
    unpromotedNightlies: catalog.unpromotedNightlies,
  };
  if (mode === "check" && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `eligible=${result.eligible}\nversion=${version}\ninclude_macos=${includeMacos}\ntag=${releaseTagName(version, "nightly")}\n`,
    );
  }
  if (mode !== "status" && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Companion Nightly release gate\n\nPending updates: **${result.pending.length}/${THRESHOLD}**. Eligible: **${result.eligible}**. Include macOS: **${includeMacos}**. Emergency: **${result.emergency}**. Operator override: **${result.operatorOverride}**.\n`,
    );
  }
  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
