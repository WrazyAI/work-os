import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalTagVersion, releaseDisplayVersion, combineRelease, findDraftRelease, macInstaller, macUpdater, releaseAssets, stageMacRelease } from "../desktop/work-os-companion/scripts/macos-release.mjs";

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


test("padded release tags resolve canonical versions and reject invalid inputs", () => {
  assert.equal(canonicalTagVersion("work-os-companion-internal-v0.4.02"), "0.4.2");
  assert.equal(canonicalTagVersion("work-os-companion-internal-v0.2.2"), "0.2.2");
  assert.equal(releaseDisplayVersion("0.4.2-beta.1+build.2"), "0.4.02-beta.1+build.2");
  assert.equal(canonicalTagVersion(`work-os-companion-internal-v${releaseDisplayVersion("0.4.2-beta.1+build.2")}`), "0.4.2-beta.1+build.2");
  assert.equal(canonicalTagVersion("work-os-companion-internal-v1.2.103-beta.1+build.2"), "1.2.103-beta.1+build.2");
  for (const tag of ["other-v0.4.02", "work-os-companion-internal-v01.4.02", "work-os-companion-internal-v0.4.02-beta.01", "work-os-companion-internal-v0.4.002"]) {
    assert.throws(() => canonicalTagVersion(tag), /Invalid internal release tag/);
  }
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


test("packaged startup gate accepts a settled launch and rejects a crash or a stuck one", async (t) => {
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
  // not enough, because that is exactly what a frozen companion did.
  const phaseWrite = 'mkdir -p "$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics"; '
    + 'printf \'%s\\n\' \'{"category":"app.boot.phase","message":"boot:connect_screen","metadata":{"phase":"boot:connect_screen"}}\' > "$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics/app-events.jsonl"';
  const [settled, stuck, crash] = await Promise.all([
    run("settled", `${phaseWrite}; echo started; exec sleep 30`),
    run("stuck", 'echo still-loading; exec sleep 30'),
    run("crash", 'echo startup-crash; exit 7'),
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
});


test("root CI still reports lint failure while executing independent verification", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /name: Install dependencies\n        id: install/);
  for (const name of ["Typecheck (work-os)", "Tests"]) {
    assert(ci.includes(`- name: ${name}\n        if: \${{ !cancelled() && steps.install.outcome == 'success' }}`));
  }
  assert.match(ci, /name: Lint\n        run: npm run lint/);
  assert.doesNotMatch(ci, /continue-on-error/);
});
