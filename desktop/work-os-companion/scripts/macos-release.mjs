import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export const STABLE_TAG_PREFIX = "work-os-companion-internal-v";
export const NIGHTLY_TAG_PREFIX = "work-os-companion-nightly-v";

export const macInstaller = "Work-OS-Companion-macOS-Universal-UNSIGNED.dmg";
export const macUpdater = "Work-OS-Companion-macOS-Universal-UNSIGNED.app.tar.gz";
export const windowsInstaller = "Work-OS-Companion-Setup-UNSIGNED.exe";
export const windowsAssets = [
  windowsInstaller,
  `${windowsInstaller}.sig`,
  "Work-OS-Companion-UNSIGNED.msi",
  "Work-OS-Companion-UNSIGNED.msi.sig",
  "Work-OS-Companion-Portable-UNSIGNED.zip",
];
export const macosAssets = [macInstaller, macUpdater, `${macUpdater}.sig`];
export const releaseAssets = [...windowsAssets, ...macosAssets, "latest-internal.json"];

const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
function checksums(stage, files, name) {
  writeFileSync(join(stage, name), files.map((file) => `${hash(join(stage, file))}  ${file}\n`).join(""));
}
function verifyChecksums(stage, name, expected) {
  const lines = readFileSync(join(stage, name), "utf8").trim().split(/\r?\n/);
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match || !expected.includes(match[2]) || seen.has(match[2]) || hash(join(stage, match[2])) !== match[1]) {
      throw new Error(`Invalid or mismatched ${name} entry`);
    }
    seen.add(match[2]);
  }
  if (seen.size !== expected.length) throw new Error(`Incomplete ${name}`);
}
function oneFile(directory, suffix) {
  const files = readdirSync(directory).filter((file) => file.endsWith(suffix) && statSync(join(directory, file)).isFile());
  if (files.length !== 1) throw new Error(`Expected one ${suffix} in ${directory}, found ${files.length}`);
  return join(directory, files[0]);
}
const assetUrl = (repository, tag, file) => `https://github.com/${repository}/releases/download/${tag}/${file}`;

export function parseReleaseTag(tag) {
  let channel = null;
  let prefix = null;
  if (typeof tag === "string" && tag.startsWith(STABLE_TAG_PREFIX)) {
    channel = "stable";
    prefix = STABLE_TAG_PREFIX;
  } else if (typeof tag === "string" && tag.startsWith(NIGHTLY_TAG_PREFIX)) {
    channel = "nightly";
    prefix = NIGHTLY_TAG_PREFIX;
  }
  if (!channel || !prefix) throw new Error("Invalid internal release tag");
  const rest = tag.slice(prefix.length);
  const match = rest.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(\d+)((?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/);
  if (!match) throw new Error("Invalid internal release tag");
  const [, major, minor, patch, suffix] = match;
  const canonicalPatch = patch.replace(/^0+(?=\d)/, "");
  const prerelease = suffix.split("+")[0].replace(/^-/, "");
  if ((patch !== canonicalPatch && patch !== canonicalPatch.padStart(2, "0")) || prerelease.split(".").some((part) => /^0\d+$/.test(part))) {
    throw new Error("Invalid internal release tag");
  }
  return { channel, version: `${major}.${minor}.${canonicalPatch}${suffix}` };
}

export function canonicalTagVersion(tag) {
  return parseReleaseTag(tag).version;
}

export function releaseDisplayVersion(version) {
  const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(.*)$/);
  if (!match) throw new Error("Invalid internal release version");
  const display = `${match[1]}.${match[2]}.${match[3].padStart(2, "0")}${match[4]}`;
  if (canonicalTagVersion(`${STABLE_TAG_PREFIX}${display}`) !== version) throw new Error("Invalid internal release version");
  return display;
}

export function releaseTagName(version, channel = "stable") {
  const display = releaseDisplayVersion(version);
  if (channel === "nightly") return `${NIGHTLY_TAG_PREFIX}${display}`;
  if (channel === "stable") return `${STABLE_TAG_PREFIX}${display}`;
  throw new Error(`Unsupported release channel: ${channel}`);
}

export function findDraftRelease(pages, tag) {
  if (!Array.isArray(pages)) throw new Error("Invalid release catalog");
  const matches = pages.flat().filter((release) => release?.tag_name === tag);
  if (matches.length > 1) throw new Error(`Ambiguous release drafts for ${tag}`);
  const release = matches[0] ?? null;
  if (release && !release.draft) throw new Error(`Release ${tag} is already published and cannot be overwritten`);
  return release;
}

export function stageMacRelease(bundle, stage, version, tag, repository) {
  mkdirSync(stage, { recursive: true });
  const archive = oneFile(join(bundle, "macos"), ".app.tar.gz");
  const signature = readFileSync(`${archive}.sig`, "utf8").trim();
  if (!signature) throw new Error("Empty Mac updater signature");
  copyFileSync(oneFile(join(bundle, "dmg"), ".dmg"), join(stage, macInstaller));
  copyFileSync(archive, join(stage, macUpdater));
  copyFileSync(`${archive}.sig`, join(stage, `${macUpdater}.sig`));
  const entry = { url: assetUrl(repository, tag, macUpdater), signature };
  writeFileSync(join(stage, "macos-updater.json"), JSON.stringify({ version, platforms: {
    "darwin-aarch64": entry, "darwin-x86_64": entry,
  } }, null, 2));
  checksums(stage, [macInstaller, macUpdater, `${macUpdater}.sig`, "macos-updater.json"], "SHA256SUMS-macos.txt");
}

export function verifyWindowsOnlyRelease(stage, version, tag, repository) {
  const windows = JSON.parse(readFileSync(join(stage, "latest-internal.json"), "utf8").replace(/^\uFEFF/, ""));
  const keys = Object.keys(windows.platforms ?? {}).sort().join();
  if (keys !== "windows-x86_64") throw new Error("Unexpected release platforms");
  const expected = [...windowsAssets, "latest-internal.json"];
  verifyChecksums(stage, "SHA256SUMS.txt", expected);
  if (windows.version !== version) throw new Error("Release versions disagree");
  const signature = readFileSync(join(stage, `${windowsInstaller}.sig`), "utf8").trim();
  const entry = windows.platforms["windows-x86_64"];
  if (!signature || entry.signature !== signature || entry.url !== assetUrl(repository, tag, windowsInstaller)) {
    throw new Error("Invalid updater entry: windows-x86_64");
  }
  for (const file of expected) {
    if (!statSync(join(stage, file)).isFile() || statSync(join(stage, file)).size === 0) throw new Error(`Missing release asset: ${file}`);
  }
}

export function combineRelease(stage, version, tag, repository) {
  const windows = JSON.parse(readFileSync(join(stage, "latest-internal.json"), "utf8").replace(/^\uFEFF/, ""));
  const keys = Object.keys(windows.platforms).sort().join();
  const combined = keys === "darwin-aarch64,darwin-x86_64,windows-x86_64";
  if (!combined && keys !== "windows-x86_64") throw new Error("Unexpected release platforms");
  verifyChecksums(stage, "SHA256SUMS.txt", combined ? releaseAssets : [...windowsAssets, "latest-internal.json"]);
  verifyChecksums(stage, "SHA256SUMS-macos.txt", [macInstaller, macUpdater, `${macUpdater}.sig`, "macos-updater.json"]);
  const mac = JSON.parse(readFileSync(join(stage, "macos-updater.json"), "utf8"));
  if (windows.version !== version || mac.version !== version) throw new Error("Release versions disagree");
  if (Object.keys(mac.platforms).sort().join() !== "darwin-aarch64,darwin-x86_64") {
    throw new Error("Unexpected release platforms");
  }
  if (combined) {
    for (const platform of Object.keys(mac.platforms)) {
      if (windows.platforms[platform].url !== mac.platforms[platform].url || windows.platforms[platform].signature !== mac.platforms[platform].signature) {
        throw new Error(`Invalid updater entry: ${platform}`);
      }
    }
  }
  const platforms = { ...windows.platforms, ...mac.platforms };
  for (const [platform, entry] of Object.entries(platforms)) {
    const file = platform === "windows-x86_64" ? windowsInstaller : macUpdater;
    const signature = readFileSync(join(stage, `${file}.sig`), "utf8").trim();
    if (!signature || entry.signature !== signature || entry.url !== assetUrl(repository, tag, file)) {
      throw new Error(`Invalid updater entry: ${platform}`);
    }
  }
  for (const file of releaseAssets) {
    if (!statSync(join(stage, file)).isFile() || statSync(join(stage, file)).size === 0) throw new Error(`Missing release asset: ${file}`);
  }
  writeFileSync(join(stage, "latest-internal.json"), JSON.stringify({ ...windows,
    notes: `UNSIGNED INTERNAL Work OS Companion ${version}. Windows is not Authenticode-signed; macOS is ad-hoc signed and not notarized. Updater artifacts are cryptographically signed.`,
    platforms,
  }, null, 2));
  checksums(stage, releaseAssets, "SHA256SUMS.txt");
}

/** Verify downloaded Nightly assets against their checksums and stage them for
 * promotion into an immutable Stable release (reusing the exact Windows
 * binaries and, when present, the exact macOS binaries without rebuilding). */
export function preparePromotionStage(nightlyDir, stageDir, version, stableTag, repository) {
  mkdirSync(stageDir, { recursive: true });
  const hasMacos = macosAssets.every((file) => existsSync(join(nightlyDir, file)));
  const expectedNightlyFiles = hasMacos ? releaseAssets : [...windowsAssets, "latest-internal.json"];
  verifyChecksums(nightlyDir, "SHA256SUMS.txt", expectedNightlyFiles);
  const nightlyManifest = JSON.parse(readFileSync(join(nightlyDir, "latest-internal.json"), "utf8").replace(/^\uFEFF/, ""));
  if (nightlyManifest.version !== version) throw new Error("Release versions disagree");

  for (const file of windowsAssets) {
    copyFileSync(join(nightlyDir, file), join(stageDir, file));
  }
  const windowsSignature = readFileSync(join(stageDir, `${windowsInstaller}.sig`), "utf8").trim();
  if (!windowsSignature) throw new Error("Empty Windows updater signature");

  const windowsManifest = {
    version,
    notes: `UNSIGNED INTERNAL Work OS Companion ${version}. The updater artifact is cryptographically signed, but the Windows executable is not Authenticode-signed.`,
    pub_date: nightlyManifest.pub_date || new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        url: assetUrl(repository, stableTag, windowsInstaller),
        signature: windowsSignature,
      },
    },
  };
  writeFileSync(join(stageDir, "latest-internal.json"), JSON.stringify(windowsManifest, null, 2));
  checksums(stageDir, [...windowsAssets, "latest-internal.json"], "SHA256SUMS.txt");

  if (hasMacos) {
    for (const file of macosAssets) {
      copyFileSync(join(nightlyDir, file), join(stageDir, file));
    }
    const macSignature = readFileSync(join(stageDir, `${macUpdater}.sig`), "utf8").trim();
    if (!macSignature) throw new Error("Empty Mac updater signature");
    const macEntry = { url: assetUrl(repository, stableTag, macUpdater), signature: macSignature };
    writeFileSync(join(stageDir, "macos-updater.json"), JSON.stringify({
      version,
      platforms: { "darwin-aarch64": macEntry, "darwin-x86_64": macEntry },
    }, null, 2));
    checksums(stageDir, [...macosAssets, "macos-updater.json"], "SHA256SUMS-macos.txt");
  }

  return { hasMacos };
}

function compareCoreVersions(a, b) {
  const parse = (v) => v.split(".").map(Number);
  const left = parse(a);
  const right = parse(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/** Extract markdown changelog sections for all versions in (fromExclusive, toInclusive],
 * newest first, so Stable promotion notes reflect every Nightly change included. */
export function extractCumulativeChangelog(markdown, fromExclusiveVersion, toInclusiveVersion) {
  const sections = [];
  let current = null;
  for (const line of String(markdown).replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^##\s+(\d+\.\d+\.\d+)\b(.*)$/);
    if (heading) {
      current = { version: heading[1], heading: line.trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (/^#\s/.test(line) || /^##\s/.test(line)) {
      current = null;
      continue;
    }
    if (current) current.lines.push(line);
  }
  const matching = sections
    .filter((section) =>
      compareCoreVersions(section.version, toInclusiveVersion) <= 0
      && (!fromExclusiveVersion || compareCoreVersions(section.version, fromExclusiveVersion) > 0),
    )
    .sort((a, b) => compareCoreVersions(b.version, a.version));
  return matching
    .map((section) => {
      const body = section.lines.join("\n").trim();
      if (!body) return null;
      return `### ${releaseDisplayVersion(section.version)}\n\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "stage" && args.length === 5) stageMacRelease(...args);
  else if (mode === "combine" && args.length === 4) combineRelease(...args);
  else if (mode === "verify-windows" && args.length === 4) verifyWindowsOnlyRelease(...args);
  else if (mode === "prepare-promotion" && args.length === 5) {
    console.log(JSON.stringify(preparePromotionStage(...args)));
  } else if (mode === "cumulative-notes" && args.length === 3) {
    console.log(extractCumulativeChangelog(readFileSync(args[0], "utf8"), args[1] || null, args[2]));
  } else if (mode === "display-version" && args.length === 1) console.log(releaseDisplayVersion(args[0]));
  else if (mode === "tag-version" && args.length === 1) console.log(canonicalTagVersion(args[0]));
  else if (mode === "select-draft" && args.length === 2) {
    const draft = findDraftRelease(JSON.parse(readFileSync(args[0], "utf8").replace(/^\uFEFF/, "")), args[1]);
    console.log(JSON.stringify(draft && { id: draft.id, draft: draft.draft, tag_name: draft.tag_name, target_commitish: draft.target_commitish }));
  } else throw new Error(`Usage: ${basename(process.argv[1])} stage <bundle> <stage> <version> <tag> <repo> | combine <stage> <version> <tag> <repo> | verify-windows <stage> <version> <tag> <repo> | prepare-promotion <nightlyDir> <stageDir> <version> <stableTag> <repo> | cumulative-notes <changelog> <fromExclusive> <toInclusive> | select-draft <catalog.json> <tag> | tag-version <tag> | display-version <version>`);
}
