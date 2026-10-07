import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("Windows executes release policy for padded tags, prereleases, and publication guards", { skip: process.platform !== "win32" }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "work-os-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workflow = readFileSync(new URL("../.github/workflows/work-os-companion-windows.yml", import.meta.url), "utf8");
  const step = workflow.slice(workflow.indexOf("      - name: Resolve and validate release metadata"), workflow.indexOf("      - name: Require changelog"));
  const source = step.slice(step.indexOf("        run: |\n") + "        run: |\n".length).trimEnd().split("\n").map((line) => line.slice(10)).join("\n");
  const script = join(root, "policy.ps1");
  writeFileSync(script, source);
  mkdirSync(join(root, "src-tauri"));
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts/macos-release.mjs"), readFileSync(new URL("../desktop/work-os-companion/scripts/macos-release.mjs", import.meta.url)));
  const run = (version, env = {}) => {
    writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version }));
    writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
    writeFileSync(join(root, "src-tauri/Cargo.toml"), `[package]\nname = "fixture"\nversion = "${version}"\n`);
    const output = join(root, "output.txt");
    writeFileSync(output, "");
    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", script], { cwd: root, encoding: "utf8", env: {
      ...process.env, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REF_NAME: "main",
      DISPATCH_VERSION: version, DISPATCH_PUBLISH: "false", DISPATCH_ACKNOWLEDGEMENT: "", ...env,
    } });
    assert.ifError(result.error);
    return { ...result, output: readFileSync(output, "utf8").replace(/^\uFEFF/, "").replaceAll("\r", "") };
  };
  for (const tag of ["work-os-companion-internal-v0.4.02", "work-os-companion-internal-v0.4.2"]) {
    const r = run("0.4.2", { GITHUB_EVENT_NAME: "push", GITHUB_REF: `refs/tags/${tag}`, GITHUB_REF_NAME: tag });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.output, /version=0.4.2\n/);
    assert.match(r.output, /tag=work-os-companion-internal-v0.4.02\n/);
    assert.match(r.output, /publish=false\n/);
  }
  const prerelease = run("0.4.2-beta.1+build.2");
  assert.equal(prerelease.status, 0, prerelease.stderr);
  assert.match(prerelease.output, /display_version=0.4.02-beta.1\+build.2\n/);
  for (const env of [
    { DISPATCH_PUBLISH: "true" },
    { DISPATCH_PUBLISH: "true", DISPATCH_ACKNOWLEDGEMENT: "UNSIGNED INTERNAL", GITHUB_REF: "refs/heads/candidate" },
    { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/work-os-companion-internal-v0.4.03", GITHUB_REF_NAME: "work-os-companion-internal-v0.4.03" },
    { GITHUB_EVENT_NAME: "push", GITHUB_REF: 'refs/tags/work-os-companion-internal-v0.4.02";throw("injection");#', GITHUB_REF_NAME: 'work-os-companion-internal-v0.4.02";throw("injection");#' },
  ]) {
    const r = run("0.4.2", env);assert.notEqual(r.status, 0);assert.equal(r.output, "");
  }
  const approved = run("0.4.2", { DISPATCH_PUBLISH: "true", DISPATCH_ACKNOWLEDGEMENT: "UNSIGNED INTERNAL" });
  assert.equal(approved.status, 0, approved.stderr);assert.match(approved.output, /publish=true\n/);
  const main = run("0.4.2", { GITHUB_EVENT_NAME: "push" });
  assert.equal(main.status, 0, main.stderr);assert.match(main.output, /publish=true\n/);
});
