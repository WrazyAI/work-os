#!/usr/bin/env node
/**
 * Builds the weekly Friday Stable release check-in summary for Work OS
 * Companion. Lists every Nightly build shipped since the latest Stable release
 * and prints instructions to manually promote a chosen version. Never
 * auto-promotes or dispatches any build.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { latestPublishedByChannel } from "./work-os-companion-release-gate.mjs";
import { extractCumulativeChangelog, releaseDisplayVersion } from "../desktop/work-os-companion/scripts/macos-release.mjs";

export function formatFridayCheckinBody({ catalog, changelogMarkdown, repository = "WrazyAI/work-os", dateIso = new Date().toISOString().slice(0, 10) }) {
  const latestStable = catalog.latestStable;
  const stableLabel = latestStable ? `${releaseDisplayVersion(latestStable.version)} (\`${latestStable.tag_name}\`)` : "none";
  const candidates = catalog.unpromotedNightlies;

  if (!candidates.length) {
    return {
      hasCandidates: false,
      title: `Weekly Stable release check-in — ${dateIso}`,
      body: [
        "## Weekly Work OS Companion Stable check-in",
        "",
        `Current **Stable** release: **${stableLabel}**.`,
        "",
        "No new **Nightly** builds have been published since the current Stable release, so nothing is waiting for promotion this Friday.",
      ].join("\n"),
    };
  }

  const newest = candidates[0];
  const rows = candidates.map((item) => {
    const platforms = item.hasMacos ? "Windows + macOS" : "Windows only (macOS will build on promotion)";
    const date = String(item.publishedAt ?? "").slice(0, 10) || "unknown";
    return `| **${item.displayVersion}** | \`${item.tag}\` | ${date} | ${platforms} |`;
  });

  const notes = extractCumulativeChangelog(changelogMarkdown, latestStable?.version ?? null, newest.version);

  const lines = [
    "## Weekly Work OS Companion Stable check-in",
    "",
    `Current **Stable** release: **${stableLabel}**.`,
    "",
    `**${candidates.length}** Nightly build${candidates.length === 1 ? "" : "s"} ${candidates.length === 1 ? "is" : "are"} available to promote to Stable:`,
    "",
    "| Version | Nightly tag | Published | Platforms built |",
    "|---|---|---|---|",
    ...rows,
    "",
    "### Should we promote a Nightly build to Stable?",
    "",
    "Nothing is promoted automatically. To ship a tested Nightly version (preserving exact version parity — e.g. promoting Nightly `" + newest.version + "` ships Stable `" + newest.version + "` without a version bump), run:",
    "",
    "```bash",
    `gh workflow run work-os-companion-promote-stable.yml \\`,
    `  --repo ${repository} \\`,
    "  --ref main \\",
    `  -f version=${newest.version} \\`,
    '  -f unsigned_acknowledgement="UNSIGNED INTERNAL"',
    "```",
    "",
    "Or trigger **Work OS Companion Promote Nightly to Stable** from the GitHub Actions tab with your chosen Nightly version.",
  ];

  if (notes) {
    lines.push("", "### Changes since Stable " + (latestStable ? releaseDisplayVersion(latestStable.version) : "baseline"), "", notes);
  }

  return {
    hasCandidates: true,
    latestNightlyVersion: newest.version,
    title: `Weekly Stable release check-in — ${dateIso} (latest Nightly ${newest.displayVersion})`,
    body: lines.join("\n"),
  };
}

function command(binary, args) {
  return execFileSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 }).trim();
}

function main() {
  const repository = process.env.GITHUB_REPOSITORY || command("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const pages = JSON.parse(command("gh", ["api", `repos/${repository}/releases?per_page=100`, "--paginate", "--slurp"]));
  const catalog = latestPublishedByChannel(pages);
  const changelogMarkdown = readFileSync("desktop/work-os-companion/CHANGELOG.md", "utf8");
  const summary = formatFridayCheckinBody({ catalog, changelogMarkdown, repository });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
