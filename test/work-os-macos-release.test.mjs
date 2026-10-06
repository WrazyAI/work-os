import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { combineRelease, macInstaller, macUpdater, releaseAssets, stageMacRelease } from "../desktop/work-os-companion/scripts/macos-release.mjs";

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
  stageMacRelease(bundle, stage, "1.2.3", "wrong-tag", "WrazyAI/work-os");
  assert.throws(() => combineRelease(stage, "1.2.3", "work-os-companion-internal-v1.2.03", "WrazyAI/work-os"), /Invalid updater entry/);
});

test("refuses ambiguous and empty updater artifacts", (t) => {
  const { stage, bundle } = fixture(t);
  writeFileSync(join(bundle, "macos", "Work OS Companion.app.tar.gz.sig"), "\n");
  assert.throws(() => stageMacRelease(bundle, stage, "1.2.3", "tag", "repo"), /Empty Mac updater signature/);
  writeFileSync(join(bundle, "macos", macUpdater), "extra");
  assert.throws(() => stageMacRelease(bundle, stage, "1.2.3", "tag", "repo"), /Expected one/);
});
