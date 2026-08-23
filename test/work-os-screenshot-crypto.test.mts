import assert from "node:assert/strict";

process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const {
  canAccessRawScreenshot,
  encryptScreenshot,
  decryptScreenshot,
  isExcludedScreenshot,
  isRetainedScreenshotAvailable,
  allowsScreenshotExecution,
} = await import("../src/lib/work-os-screenshots");

const source = Buffer.from("private screenshot bytes");
const encrypted = encryptScreenshot(source);
assert.notDeepEqual(encrypted, source);
assert.deepEqual(decryptScreenshot(encrypted), source);

const tampered = Buffer.from(encrypted);
tampered[tampered.length - 1] ^= 1;
assert.throws(() => decryptScreenshot(tampered));

const policy = { sensitiveApps: ["password manager"], sensitiveDomains: ["bank.example"] };
assert.equal(isExcludedScreenshot({ Title: "Password Manager", Url: "https://work.example" } as never, policy), true);
assert.equal(isExcludedScreenshot({ Title: "Browser", Url: "https://bank.example/accounts" } as never, policy), true);
assert.equal(isExcludedScreenshot({ Title: "Editor", Url: "https://repo.example" } as never, policy), false);

assert.equal(canAccessRawScreenshot({ ownScreenshot: true, reviewable: false }), true);
assert.equal(canAccessRawScreenshot({ ownScreenshot: false, reviewable: true }), true);
assert.equal(canAccessRawScreenshot({ ownScreenshot: false, reviewable: false }), false);
assert.equal(isRetainedScreenshotAvailable({ storage_path: "org/person/image.enc", expires_at: "2026-08-12T00:00:00.000Z" }, Date.parse("2026-08-11T00:00:00.000Z")), true);
assert.equal(isRetainedScreenshotAvailable({ storage_path: "org/person/image.enc", expires_at: "2026-08-10T00:00:00.000Z" }, Date.parse("2026-08-11T00:00:00.000Z")), false);
assert.equal(isRetainedScreenshotAvailable({ storage_path: "org/person/image.enc", deleted_at: "2026-08-10T00:00:00.000Z", expires_at: "2026-08-12T00:00:00.000Z" }, Date.parse("2026-08-11T00:00:00.000Z")), false);

// The normal worker reads the actual organization feature flag. A one-image
// server-only readiness smoke is the sole pre-activation execution path.
assert.equal(allowsScreenshotExecution(true, "feature"), true);
assert.equal(allowsScreenshotExecution(false, "feature"), false);
assert.equal(allowsScreenshotExecution(false, "readiness_smoke"), true);
assert.equal(allowsScreenshotExecution(true, "readiness_smoke"), false);

console.log("Work OS screenshot encryption tests passed.");
