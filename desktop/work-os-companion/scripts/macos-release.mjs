import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export const macInstaller = "Work-OS-Companion-macOS-Universal-UNSIGNED.dmg";
export const macUpdater = "Work-OS-Companion-macOS-Universal-UNSIGNED.app.tar.gz";
const windowsInstaller = "Work-OS-Companion-Setup-UNSIGNED.exe";
export const releaseAssets = [windowsInstaller, `${windowsInstaller}.sig`, "Work-OS-Companion-UNSIGNED.msi",
  "Work-OS-Companion-UNSIGNED.msi.sig", "Work-OS-Companion-Portable-UNSIGNED.zip",
  macInstaller, macUpdater, `${macUpdater}.sig`, "latest-internal.json"];
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

export function combineRelease(stage, version, tag, repository) {
  const windows = JSON.parse(readFileSync(join(stage, "latest-internal.json"), "utf8").replace(/^\uFEFF/, ""));
  const keys = Object.keys(windows.platforms).sort().join();
  const combined = keys === "darwin-aarch64,darwin-x86_64,windows-x86_64";
  if (!combined && keys !== "windows-x86_64") throw new Error("Unexpected release platforms");
  verifyChecksums(stage, "SHA256SUMS.txt", combined ? releaseAssets : releaseAssets.slice(0, 5).concat("latest-internal.json"));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "stage" && args.length === 5) stageMacRelease(...args);
  else if (mode === "combine" && args.length === 4) combineRelease(...args);
  else if (mode === "select-draft" && args.length === 2) {
    const draft = findDraftRelease(JSON.parse(readFileSync(args[0], "utf8").replace(/^\uFEFF/, "")), args[1]);
    console.log(JSON.stringify(draft && { id: draft.id, draft: draft.draft, tag_name: draft.tag_name, target_commitish: draft.target_commitish }));
  } else throw new Error(`Usage: ${basename(process.argv[1])} stage <bundle> <stage> <version> <tag> <repo> | combine <stage> <version> <tag> <repo> | select-draft <catalog.json> <tag>`);
}
