import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  canonicalTagVersion,
  releaseDisplayVersion,
  combineRelease,
  extractCumulativeChangelog,
  findDraftRelease,
  macInstaller,
  macUpdater,
  parseReleaseTag,
  preparePromotionStage,
  releaseAssetNames,
  releaseAssets,
  releaseTagName,
  stageMacRelease,
  verifyWindowsOnlyRelease,
  windowsAssets,
  windowsInstaller,
} from "../desktop/work-os-companion/scripts/macos-release.mjs";

test("finds an unpublished draft in the paginated catalog without a Git tag", () => {
  const draft = { id: 1, tag_name: "candidate", draft: true, target_commitish: "source" };
  assert.deepEqual(findDraftRelease([[{ ...draft, tag_name: "older" }], [draft]], "candidate"), draft);
  assert.equal(findDraftRelease([[draft]], "missing"), null);
  assert.throws(() => findDraftRelease([[draft], [draft]], "candidate"), /Ambiguous/);
  assert.throws(() => findDraftRelease([[{ ...draft, draft: false }]], "candidate"), /already published/);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "work-os-mac-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, "bundle");
  const stage = join(root, "stage");
  mkdirSync(join(bundle, "macos"), { recursive: true });
  mkdirSync(join(bundle, "dmg"));
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz"), "mac-archive");
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz.sig"), "mac-signature\n");
  writeFileSync(join(bundle, "dmg", "Work OS Companion.dmg"), "mac-dmg");
  stageMacRelease(bundle, stage, "1.2.3", "work-os-companion-internal-v1.2.03", "WrazyAI/work-os");
  for (const file of releaseAssets.slice(0, 5)) writeFileSync(join(stage, file), file.endsWith(".sig") ? "windows-signature\n" : "windows-binary");
  writeFileSync(join(stage, "latest-internal.json"), JSON.stringify({ version: "1.2.3", platforms: {
    "windows-x86_64": { signature: "windows-signature", url: "https://github.com/WrazyAI/work-os/releases/download/work-os-companion-internal-v1.2.03/Work-OS-Companion-Setup-UNSIGNED.exe" },
  } }));
  const checksumFiles = releaseAssets.slice(0, 5).concat("latest-internal.json");
  writeFileSync(join(stage, "SHA256SUMS.txt"), checksumFiles.map((file) => `${createHash("sha256").update(readFileSync(join(stage, file))).digest("hex")}  ${file}\n`).join(""));
  return { stage, bundle, combine: () => combineRelease(stage, "1.2.3", "work-os-companion-internal-v1.2.03", "WrazyAI/work-os") };
}

test("combines Windows and universal Mac updater entries with checksums for every asset", (t) => {
  const { stage, combine } = fixture(t);
  combine();
  const manifest = JSON.parse(readFileSync(join(stage, "latest-internal.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"]);
  assert.equal(manifest.platforms["darwin-aarch64"].signature, "mac-signature");
  assert.equal(manifest.platforms["darwin-aarch64"].url, manifest.platforms["darwin-x86_64"].url);
  assert.equal(readFileSync(join(stage, "SHA256SUMS.txt"), "utf8").trim().split("\n").length, releaseAssets.length);
});

test("refuses damaged binaries before publication", (t) => {
  const { stage, combine } = fixture(t);
  writeFileSync(join(stage, macInstaller), "tampered");
  assert.throws(combine, /mismatched/);
});

test("can safely finalize again after combined assets have been uploaded", (t) => {
  const { stage, combine } = fixture(t);
  combine();
  const manifest = readFileSync(join(stage, "latest-internal.json"), "utf8");
  const checksums = readFileSync(join(stage, "SHA256SUMS.txt"), "utf8");
  combine();
  assert.equal(readFileSync(join(stage, "latest-internal.json"), "utf8"), manifest);
  assert.equal(readFileSync(join(stage, "SHA256SUMS.txt"), "utf8"), checksums);
  writeFileSync(join(stage, macUpdater), "corrupt-after-upload");
  assert.throws(combine, /mismatched/);
});

test("refuses a different Mac version even with valid checksums", (t) => {
  const { stage, combine } = fixture(t);
  assert.throws(() => combineRelease(stage, "1.2.4", "work-os-companion-internal-v1.2.03", "WrazyAI/work-os"), /versions disagree/);
  assert.doesNotThrow(combine);
});

test("rejects mismatched signature or release URL in the manifest", (t) => {
  const { stage, bundle } = fixture(t);
  stageMacRelease(bundle, stage, "1.2.3", "work-os-companion-internal-v1.2.04", "WrazyAI/work-os");
  assert.throws(() => combineRelease(stage, "1.2.3", "work-os-companion-internal-v1.2.03", "WrazyAI/work-os"), /Invalid updater entry/);
});

test("refuses ambiguous and empty updater artifacts", (t) => {
  const { stage, bundle } = fixture(t);
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz.sig"), "\n");
  assert.throws(() => stageMacRelease(bundle, stage, "1.2.3", "work-os-companion-internal-v1.2.03", "repo"), /Empty Mac updater signature/);
  writeFileSync(join(bundle, "macos", macUpdater), "extra");
  assert.throws(() => stageMacRelease(bundle, stage, "1.2.3", "work-os-companion-internal-v1.2.03", "repo"), /Expected one/);
});


test("padded release tags resolve canonical versions and reject invalid inputs", () => {
  assert.equal(canonicalTagVersion("work-os-companion-internal-v0.4.02"), "0.4.2");
  assert.equal(canonicalTagVersion("work-os-companion-internal-v0.2.2"), "0.2.2");
  assert.equal(releaseDisplayVersion("0.4.2-beta.1+build.2"), "0.4.02-beta.1+build.2");
  assert.equal(canonicalTagVersion(`work-os-companion-internal-v${releaseDisplayVersion("0.4.2-beta.1+build.2")}`), "0.4.2-beta.1+build.2");
  assert.equal(canonicalTagVersion("work-os-companion-internal-v1.2.103-beta.1+build.2"), "1.2.103-beta.1+build.2");
  for (const tag of ["other-v0.4.02", "work-os-companion-internal-v01.4.02", "work-os-companion-internal-v0.4.02-beta.01", "work-os-companion-internal-v0.4.002"]) {
    assert.throws(() => canonicalTagVersion(tag), /Invalid internal release tag/);
  }
  assert.deepEqual(parseReleaseTag("work-os-companion-nightly-v0.5.07"), { channel: "nightly", version: "0.5.7" });
  assert.deepEqual(parseReleaseTag("work-os-companion-internal-v0.5.07"), { channel: "stable", version: "0.5.7" });
  assert.equal(releaseTagName("0.5.7", "nightly"), "work-os-companion-nightly-v0.5.07");
  assert.equal(releaseTagName("0.5.7", "stable"), "work-os-companion-internal-v0.5.07");
});

test("Nightly downloads carry Nightly names while Stable keeps the website contract", () => {
  const nightly = releaseAssetNames("nightly");
  const stable = releaseAssetNames("stable");
  assert.match(nightly.windowsInstaller, /Nightly-Setup/);
  assert.match(nightly.windowsMsi, /Nightly-UNSIGNED\.msi$/);
  assert.match(nightly.windowsPortable, /Nightly-Portable/);
  assert.match(nightly.macInstaller, /Nightly-macOS-Universal/);
  assert.match(nightly.macUpdater, /Nightly-macOS-Universal/);
  assert.equal(nightly.windowsPortableExe, stable.windowsPortableExe);
  assert.equal(stable.windowsInstaller, windowsInstaller);
  assert.deepEqual(stable.releaseAssets, releaseAssets);
  assert.equal(nightly.releaseAssets.filter((file) => file.includes("Nightly")).length, 8);
  assert.throws(() => releaseAssetNames("beta"), /Unsupported release channel/);
});

test("stages Mac assets under the Nightly names", (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-mac-nightly-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, "bundle");
  const stage = join(root, "stage");
  mkdirSync(join(bundle, "macos"), { recursive: true });
  mkdirSync(join(bundle, "dmg"));
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz"), "mac-archive");
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz.sig"), "mac-signature\n");
  writeFileSync(join(bundle, "dmg", "Work OS Companion.dmg"), "mac-dmg");
  const tag = "work-os-companion-nightly-v1.2.03";
  stageMacRelease(bundle, stage, "1.2.3", tag, "WrazyAI/work-os");
  const nightly = releaseAssetNames("nightly");
  const stable = releaseAssetNames("stable");
  assert.equal(existsSync(join(stage, nightly.macInstaller)), true);
  assert.equal(existsSync(join(stage, nightly.macUpdater)), true);
  assert.equal(existsSync(join(stage, stable.macInstaller)), false);
  const manifest = JSON.parse(readFileSync(join(stage, "macos-updater.json"), "utf8"));
  assert.equal(manifest.platforms["darwin-aarch64"].url, `https://github.com/WrazyAI/work-os/releases/download/${tag}/${nightly.macUpdater}`);
});

test("finalizes a Nightly release under the Nightly asset names", (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-nightly-combine-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, "bundle");
  const stage = join(root, "stage");
  mkdirSync(join(bundle, "macos"), { recursive: true });
  mkdirSync(join(bundle, "dmg"));
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz"), "mac-archive");
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz.sig"), "mac-signature\n");
  writeFileSync(join(bundle, "dmg", "Work OS Companion.dmg"), "mac-dmg");
  const tag = "work-os-companion-nightly-v1.2.03";
  const names = releaseAssetNames("nightly");
  stageMacRelease(bundle, stage, "1.2.3", tag, "WrazyAI/work-os");
  for (const file of names.windowsAssets) {
    writeFileSync(join(stage, file), file.endsWith(".sig") ? "windows-signature\n" : `windows-${file}`);
  }
  writeFileSync(join(stage, "latest-internal.json"), JSON.stringify({ version: "1.2.3", platforms: {
    "windows-x86_64": { signature: "windows-signature", url: `https://github.com/WrazyAI/work-os/releases/download/${tag}/${names.windowsInstaller}` },
  } }));
  const windowsFiles = [...names.windowsAssets, "latest-internal.json"];
  writeFileSync(
    join(stage, "SHA256SUMS.txt"),
    windowsFiles.map((file) => `${createHash("sha256").update(readFileSync(join(stage, file))).digest("hex")}  ${file}\n`).join(""),
  );

  combineRelease(stage, "1.2.3", tag, "WrazyAI/work-os");
  const manifest = JSON.parse(readFileSync(join(stage, "latest-internal.json"), "utf8"));
  assert.match(manifest.notes, /^NIGHTLY \(UNSIGNED\)/);
  assert.equal(manifest.platforms["darwin-aarch64"].url, `https://github.com/WrazyAI/work-os/releases/download/${tag}/${names.macUpdater}`);
  const checksumNames = readFileSync(join(stage, "SHA256SUMS.txt"), "utf8").trim().split("\n").map((line) => line.split("  ")[1]).sort();
  assert.deepEqual(checksumNames, [...names.releaseAssets].sort());
});

test("renames Nightly Mac assets to Stable names during promotion", (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-promote-mac-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const nightly = join(root, "nightly");
  const promoted = join(root, "promoted");
  mkdirSync(nightly, { recursive: true });
  const nightlyNames = releaseAssetNames("nightly");
  const stableNames = releaseAssetNames("stable");
  const tag = "work-os-companion-nightly-v1.2.03";
  for (const file of [...nightlyNames.windowsAssets, ...nightlyNames.macosAssets]) {
    writeFileSync(join(nightly, file), file.endsWith(".sig") ? "signature\n" : `bytes-${file}`);
  }
  const macEntry = { signature: "signature", url: `https://github.com/WrazyAI/work-os/releases/download/${tag}/${nightlyNames.macUpdater}` };
  writeFileSync(join(nightly, "latest-internal.json"), JSON.stringify({
    version: "1.2.3",
    platforms: {
      "windows-x86_64": { signature: "signature", url: `https://github.com/WrazyAI/work-os/releases/download/${tag}/${nightlyNames.windowsInstaller}` },
      "darwin-aarch64": macEntry,
      "darwin-x86_64": macEntry,
    },
  }));
  writeFileSync(join(nightly, "macos-updater.json"), JSON.stringify({ version: "1.2.3", platforms: {
    "darwin-aarch64": macEntry,
    "darwin-x86_64": macEntry,
  } }));
  const files = [...nightlyNames.windowsAssets, ...nightlyNames.macosAssets, "latest-internal.json"];
  writeFileSync(
    join(nightly, "SHA256SUMS.txt"),
    files.map((file) => `${createHash("sha256").update(readFileSync(join(nightly, file))).digest("hex")}  ${file}\n`).join(""),
  );
  const macChecksums = files.filter((file) => file.startsWith("Work-OS-Companion-Nightly-macOS"));
  writeFileSync(
    join(nightly, "SHA256SUMS-macos.txt"),
    macChecksums.map((file) => `${createHash("sha256").update(readFileSync(join(nightly, file))).digest("hex")}  ${file}\n`).join(""),
  );

  const result = preparePromotionStage(nightly, promoted, "1.2.3", "work-os-companion-internal-v1.2.03", "WrazyAI/work-os");
  assert.equal(result.hasMacos, true);
  assert.equal(existsSync(join(promoted, stableNames.macInstaller)), true);
  assert.equal(existsSync(join(promoted, stableNames.macUpdater)), true);
  assert.equal(existsSync(join(promoted, nightlyNames.macInstaller)), false);
  const macManifest = JSON.parse(readFileSync(join(promoted, "macos-updater.json"), "utf8"));
  assert.equal(macManifest.platforms["darwin-aarch64"].url, `https://github.com/WrazyAI/work-os/releases/download/work-os-companion-internal-v1.2.03/${stableNames.macUpdater}`);
});

test("finalizes a legacy-Windows Nightly with Nightly macOS assets", (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-nightly-mixed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bundle = join(root, "bundle");
  const stage = join(root, "stage");
  mkdirSync(join(bundle, "macos"), { recursive: true });
  mkdirSync(join(bundle, "dmg"));
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz"), "mac-archive");
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz.sig"), "mac-signature\n");
  writeFileSync(join(bundle, "dmg", "Work OS Companion.dmg"), "mac-dmg");
  const tag = "work-os-companion-nightly-v1.2.03";
  const nightly = releaseAssetNames("nightly");
  stageMacRelease(bundle, stage, "1.2.3", tag, "WrazyAI/work-os");
  for (const file of windowsAssets) {
    writeFileSync(join(stage, file), file.endsWith(".sig") ? "windows-signature\n" : `windows-${file}`);
  }
  const macEntry = { signature: "mac-signature", url: `https://github.com/WrazyAI/work-os/releases/download/${tag}/${nightly.macUpdater}` };
  writeFileSync(join(stage, "latest-internal.json"), JSON.stringify({ version: "1.2.3", platforms: {
    "windows-x86_64": { signature: "windows-signature", url: `https://github.com/WrazyAI/work-os/releases/download/${tag}/${windowsInstaller}` },
    "darwin-aarch64": macEntry,
    "darwin-x86_64": macEntry,
  } }));
  const releaseFiles = [...windowsAssets, ...nightly.macosAssets, "latest-internal.json"];
  writeFileSync(
    join(stage, "SHA256SUMS.txt"),
    releaseFiles.map((file) => `${createHash("sha256").update(readFileSync(join(stage, file))).digest("hex")}  ${file}\n`).join(""),
  );

  assert.doesNotThrow(() => combineRelease(stage, "1.2.3", tag, "WrazyAI/work-os"));
  const checksumNames = readFileSync(join(stage, "SHA256SUMS.txt"), "utf8").trim().split("\n").map((line) => line.split("  ")[1]).sort();
  assert.deepEqual(checksumNames, [...releaseFiles].sort());
});

test("rejects a stray Nightly macOS asset in a legacy Windows-only Nightly", (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-legacy-mac-stray-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stage = join(root, "stage");
  mkdirSync(stage, { recursive: true });
  for (const file of windowsAssets) {
    writeFileSync(join(stage, file), file.endsWith(".sig") ? "windows-signature\n" : `windows-${file}`);
  }
  const tag = "work-os-companion-nightly-v1.2.03";
  writeFileSync(join(stage, "latest-internal.json"), JSON.stringify({ version: "1.2.3", platforms: {
    "windows-x86_64": { signature: "windows-signature", url: `https://github.com/WrazyAI/work-os/releases/download/${tag}/${windowsInstaller}` },
  } }));
  const releaseFiles = [...windowsAssets, "latest-internal.json"];
  writeFileSync(
    join(stage, "SHA256SUMS.txt"),
    releaseFiles.map((file) => `${createHash("sha256").update(readFileSync(join(stage, file))).digest("hex")}  ${file}\n`).join(""),
  );
  writeFileSync(join(stage, releaseAssetNames("nightly").macInstaller), "stray-nightly-dmg");
  assert.throws(() => verifyWindowsOnlyRelease(stage, "1.2.3", tag, "WrazyAI/work-os"), /unexpected macOS assets/);
});

test("verifies Windows-only Nightlies and promotes verified Nightly assets to Stable without Windows rebuild", (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-promote-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const nightly = join(root, "nightly");
  const promoted = join(root, "promoted");
  mkdirSync(nightly, { recursive: true });
  const nightlyNames = releaseAssetNames("nightly");
  for (const file of nightlyNames.windowsAssets) {
    writeFileSync(join(nightly, file), file.endsWith(".sig") ? "win-sig\n" : `bytes-${file}`);
  }
  const nightlyTag = "work-os-companion-nightly-v0.5.53";
  const stableTag = "work-os-companion-internal-v0.5.53";
  writeFileSync(join(nightly, "latest-internal.json"), JSON.stringify({
    version: "0.5.53",
    pub_date: "2026-11-26T00:00:00Z",
    platforms: {
      "windows-x86_64": {
        url: `https://github.com/WrazyAI/work-os/releases/download/${nightlyTag}/${nightlyNames.windowsInstaller}`,
        signature: "win-sig",
      },
    },
  }));
  const files = [...nightlyNames.windowsAssets, "latest-internal.json"];
  writeFileSync(
    join(nightly, "SHA256SUMS.txt"),
    files.map((file) => `${createHash("sha256").update(readFileSync(join(nightly, file))).digest("hex")}  ${file}\n`).join(""),
  );

  assert.doesNotThrow(() => verifyWindowsOnlyRelease(nightly, "0.5.53", nightlyTag, "WrazyAI/work-os"));
  // Retained macOS assets in a Windows-only draft must fail closed before publication.
  writeFileSync(join(nightly, nightlyNames.macInstaller), "stale-mac-dmg");
  assert.throws(() => verifyWindowsOnlyRelease(nightly, "0.5.53", nightlyTag, "WrazyAI/work-os"), /unexpected macOS assets/);
  rmSync(join(nightly, nightlyNames.macInstaller));
  const result = preparePromotionStage(nightly, promoted, "0.5.53", stableTag, "WrazyAI/work-os");
  assert.equal(result.hasMacos, false);
  const stableManifest = JSON.parse(readFileSync(join(promoted, "latest-internal.json"), "utf8"));
  assert.equal(stableManifest.version, "0.5.53");
  assert.equal(
    stableManifest.platforms["windows-x86_64"].url,
    `https://github.com/WrazyAI/work-os/releases/download/${stableTag}/${windowsInstaller}`,
  );
  assert.equal(stableManifest.platforms["windows-x86_64"].signature, "win-sig");
  assert.equal(
    readFileSync(join(promoted, windowsInstaller), "utf8"),
    readFileSync(join(nightly, nightlyNames.windowsInstaller), "utf8"),
  );

  // Tampered Nightly asset must fail closed before promotion.
  writeFileSync(join(nightly, nightlyNames.windowsInstaller), "tampered");
  assert.throws(() => preparePromotionStage(nightly, join(root, "bad"), "0.5.53", stableTag, "WrazyAI/work-os"), /mismatched/);

  const cumulative = extractCumulativeChangelog(
    "# Changelog\n\n## Unreleased\n\n- Pending.\n\n## 0.5.53 — 2026-11-26\n\n- Feature B.\n\n## 0.5.52 — 2026-11-25\n\n- Feature A.\n\n## 0.5.51 — 2026-11-20\n\n- Already stable.\n",
    "0.5.51",
    "0.5.53",
  );
  assert.match(cumulative, /### 0\.5\.53[\s\S]*Feature B[\s\S]*### 0\.5\.52[\s\S]*Feature A/);
  assert.doesNotMatch(cumulative, /Already stable|Pending/);
});

test("promotes a pre-rename Nightly that still uses Stable asset names", (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-promote-legacy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const nightly = join(root, "nightly");
  const promoted = join(root, "promoted");
  mkdirSync(nightly, { recursive: true });
  for (const file of windowsAssets) {
    writeFileSync(join(nightly, file), file.endsWith(".sig") ? "win-sig\n" : `legacy-${file}`);
  }
  const nightlyTag = "work-os-companion-nightly-v0.5.53";
  const stableTag = "work-os-companion-internal-v0.5.53";
  writeFileSync(join(nightly, "latest-internal.json"), JSON.stringify({
    version: "0.5.53",
    platforms: {
      "windows-x86_64": {
        url: `https://github.com/WrazyAI/work-os/releases/download/${nightlyTag}/${windowsInstaller}`,
        signature: "win-sig",
      },
    },
  }));
  const files = [...windowsAssets, "latest-internal.json"];
  writeFileSync(
    join(nightly, "SHA256SUMS.txt"),
    files.map((file) => `${createHash("sha256").update(readFileSync(join(nightly, file))).digest("hex")}  ${file}\n`).join(""),
  );

  assert.doesNotThrow(() => verifyWindowsOnlyRelease(nightly, "0.5.53", nightlyTag, "WrazyAI/work-os"));
  const result = preparePromotionStage(nightly, promoted, "0.5.53", stableTag, "WrazyAI/work-os");
  assert.equal(result.hasMacos, false);
  assert.equal(
    readFileSync(join(promoted, windowsInstaller), "utf8"),
    readFileSync(join(nightly, windowsInstaller), "utf8"),
  );
});

test("release mutations serialize across refs and publication checks packaged startup", () => {
  const release = readFileSync(new URL("../.github/workflows/work-os-companion-windows.yml", import.meta.url), "utf8");
  const check = readFileSync(new URL("../.github/workflows/work-os-companion-macos-check.yml", import.meta.url), "utf8");
  assert.match(release, /group: work-os-companion-internal-release\n/);
  assert.match(release, /queue: max/);
  const metadata = release.slice(release.indexOf("      - name: Resolve and validate release metadata"), release.indexOf("      - name: Require changelog"));
  assert.doesNotMatch(metadata, /\$\{\{ github\.(ref|ref_name|event_name) \}\}/);
  assert.match(metadata, /\$env:GITHUB_REF_NAME/);
  assert.match(release, /node scripts\/macos-release.mjs tag-version/);
  for (const workflow of [release, check]) {
    assert.match(workflow, /run: bash scripts\/check-macos-startup.sh/);
    assert.match(workflow, /src-tauri\/target\/universal-apple-darwin\/release\/bundle/);
    assert.match(workflow, /name: Clear cached installer outputs/);
    assert.match(workflow, /if: failure\(\)/);
  }
});


test("packaged startup gate accepts a settled launch and rejects a crash, a stuck one, or a panicking vault", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-startup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("../desktop/work-os-companion/scripts/check-macos-startup.sh", import.meta.url));
  const run = async (name, body) => {
    const cwd = join(root, name);
    const home = join(cwd, "home");
    const bin = join(cwd, "bin");
    const binary = join(cwd, "src-tauri/target/universal-apple-darwin/release/bundle/macos/Work OS Companion.app/Contents/MacOS/work-os-companion");
    mkdirSync(join(binary, ".."), { recursive: true });
    mkdirSync(home, { recursive: true });
    // The gate seeds a real Keychain item on macOS; the test must never touch
    // one, so `security` is shimmed and its arguments are recorded.
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "security"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${cwd}/security-calls.log"\n`, { mode: 0o755 });
    writeFileSync(binary, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
    return new Promise((resolve, reject) => {
      const child = spawn("bash", [script], {
        cwd,
        env: {
          ...process.env,
          RUNNER_TEMP: cwd,
          HOME: home,
          PATH: `${bin}:${process.env.PATH}`,
          COMPANION_GATE_SECONDS: "3",
        },
      });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({
        code,
        output,
        log: readFileSync(join(cwd, "companion-startup.log"), "utf8"),
        securityCalls: existsSync(join(cwd, "security-calls.log")) ? readFileSync(join(cwd, "security-calls.log"), "utf8") : "",
      }));
    });
  };
  // The gate reads the app's own boot phases: a launch that only stays alive is
  // not enough, because that is exactly what a frozen companion did, and a
  // panicking one leaves a retry screen that can only panic again.
  const phaseWrite = 'mkdir -p "$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics"; '
    + 'printf \'%s\\n\' \'{"category":"app.boot.phase","message":"boot:connect_screen","metadata":{"phase":"boot:connect_screen"}}\' > "$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics/app-events.jsonl"';
  const failureScreenWrite = 'mkdir -p "$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics"; '
    + 'printf \'%s\\n\' \'{"category":"app.boot.phase","message":"boot:vault_failed","metadata":{"phase":"boot:vault_failed"}}\' > "$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics/app-events.jsonl"';
  const panickingWrite = `${phaseWrite}; printf '%s\\n' '{"category":"rust.panic","message":"panicked at tauri-plugin-stronghold/src/kdf.rs:37:41: Failed to write salt for Stronghold"}' >> "$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics/app-events.jsonl"`;
  const [settled, stuck, crash, panicked, failureOnFresh] = await Promise.all([
    run("settled", `${phaseWrite}; echo started; exec sleep 30`),
    run("stuck", 'echo still-loading; exec sleep 30'),
    run("crash", 'echo startup-crash; exit 7'),
    run("panicked", `${panickingWrite}; echo panicking; exec sleep 30`),
    run("failure-on-fresh", `${failureScreenWrite}; echo vault-failed; exec sleep 30`),
  ]);
  assert.equal(settled.code, 0);
  assert.match(settled.log, /started/);
  assert.match(settled.output, /boot gate settled at boot:connect_screen/);
  // The second scenario seeds a saved key this build is not trusted for, so the
  // gate is exercised against the state an in-place update creates.
  assert.match(settled.securityCalls, /add-generic-password -s com\.wrazy\.workos -a stronghold-vault/);
  assert.equal(stuck.code, 1);
  assert.match(stuck.output, /never got past its loading screen/);
  assert.equal(crash.code, 1);
  assert.match(crash.output, /startup-crash/);
  assert.equal(panicked.code, 1);
  assert.match(panicked.output, /the host panicked while opening the local vault/);
  assert.match(panicked.output, /Failed to write salt/);
  // A fresh device can always read its own key, so a failure screen there means
  // the local vault is broken on first run.
  assert.equal(failureOnFresh.code, 1);
  assert.match(failureOnFresh.output, /settled on a failure screen \(boot:vault_failed\)/);
});


test("root CI still reports lint failure while executing independent verification", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /name: Install dependencies\n        id: install/);
  for (const name of ["Typecheck (work-os)", "Site, film and publication checks", "Production build"]) {
    assert(ci.includes(`- name: ${name}\n        if: \${{ !cancelled() && steps.install.outcome == 'success' }}`));
  }
  // Sharded Work OS tests run as an independent job (no `needs: verify`), so a
  // lint failure still fails CI without suppressing the test suite.
  assert.match(ci, /\n  tests:\n[\s\S]*?fail-fast: false[\s\S]*?node scripts\/run-work-os-tests\.mjs --suite=work-os --shard=\$\{\{ matrix\.shard \}\}/);
  const testsJob = ci.slice(ci.indexOf("\n  tests:\n"), ci.indexOf("\n  companion:\n"));
  assert.doesNotMatch(testsJob, /\n    needs:/);
  assert.match(ci, /name: Lint\n        run: npm run lint/);
  assert.doesNotMatch(ci, /continue-on-error/);
});
