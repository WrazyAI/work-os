// work-os surface guard.
//
// The work-os repo intentionally ships a thin, standalone layout (no shared
// Shell/sidebar/providers) and its own minimal next.config.mjs. The 2026-09-11
// convergence canary showed that bulk syncing between work-os and agent-os
// clobbers whichever side is treated as the source of truth. This test fails
// fast if work-os's standalone surface is replaced by agent-os variants.
//
// This file is work-os-only. agent-os has its own guard:
// test/agent-os-surface.test.mts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_PATHS = [
  "src/app/layout.tsx",
  "src/app/globals.css",
  "src/app/work-os/page.tsx",
  "src/app/login/page.tsx",
  "src/app/forgot-password/page.tsx",
  "src/app/reset-password/page.tsx",
  "src/lib/passwordResetEmail.ts",
  "src/lib/work-os-proposals.ts",
  "src/lib/work-os-employee-tasks.ts",
  "src/proxy.ts",
  "next.config.mjs",
  "design.md",
  "desktop/work-os-companion/package.json",
];

test("work-os surface files exist", () => {
  const missing = REQUIRED_PATHS.filter((relativePath) => !existsSync(path.join(root, relativePath)));
  assert.deepEqual(missing, [], `missing work-os surface files: ${missing.join(", ")}`);
});

test("work-os layout stays standalone (no agent-os shell imports)", () => {
  const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  assert.doesNotMatch(layout, /@\/components\//, "work-os layout must not import agent-os components");
  assert.doesNotMatch(layout, /WrazyOS/, "work-os layout keeps its own Work OS metadata");
  assert.equal(
    existsSync(path.join(root, "src/components")),
    false,
    "src/components is an agent-os surface and must not appear in work-os",
  );
});

test("work-os keeps its own next config", () => {
  assert.ok(existsSync(path.join(root, "next.config.mjs")), "next.config.mjs must exist in work-os");
});

test("password reset is public and wired for every role", () => {
  const login = readFileSync(path.join(root, "src/app/login/page.tsx"), "utf8");
  const forgot = readFileSync(path.join(root, "src/app/forgot-password/page.tsx"), "utf8");
  const reset = readFileSync(path.join(root, "src/app/reset-password/page.tsx"), "utf8");
  const auth = readFileSync(path.join(root, "src/lib/auth.ts"), "utf8");
  const proxy = readFileSync(path.join(root, "src/proxy.ts"), "utf8");

  assert.match(login, />WrazyOS<\/h1>/, "the auth screen must say WrazyOS");
  assert.doesNotMatch(login, />Work OS<\/h1>/, "the old Work OS title must be gone");
  assert.match(login, /<h1 style=\{\{ fontSize: 20, margin: 0, color: "#e8e9ec" \}\}>WrazyOS<\/h1>/, "the title must carry its own color (the global heading token is light-theme dark)");
  assert.match(login, /\/forgot-password/, "the auth screen must offer the reset flow");
  assert.match(forgot, /\/api\/auth\/request-password-reset/, "the forgot page requests the reset email");
  assert.match(reset, /\/api\/auth\/reset-password/, "the reset page submits the new password");
  assert.match(reset, /searchParams\.get\("token"\)/, "the reset page reads the email token");
  assert.match(auth, /sendResetPassword/, "Better Auth must send reset emails");
  assert.match(proxy, /"\/forgot-password"/, "the reset request page must be public");
  assert.match(proxy, /"\/reset-password"/, "the reset page must be public");
});
