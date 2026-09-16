import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const { screenshotExclusionKind } = await import("../src/lib/work-os-screenshots");

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("exclusion kinds classify stored and legacy frames", () => {
  assert.equal(screenshotExclusionKind({ exclusionKind: "policy" }, "Excluded by sensitive app/domain policy."), "policy");
  assert.equal(screenshotExclusionKind({ exclusionKind: "sensitive", sensitiveReason: "a credential dialog is open" }, "Excluded after sensitive-content detection: a credential dialog is open."), "sensitive");
  assert.equal(screenshotExclusionKind({}, "Excluded by sensitive app/domain policy."), "policy");
  assert.equal(screenshotExclusionKind(null, "Excluded after sensitive-content detection."), "sensitive");
  assert.equal(screenshotExclusionKind(undefined, undefined), "sensitive");
});

test("sensitivity prompt stays precise and records a reason", async () => {
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /sensitive_reason/);
  assert.match(lib, /credential/i);
  assert.match(lib, /Ordinary work context is NOT sensitive/);
  assert.match(lib, /exclusionKind: "sensitive"/);
  assert.match(lib, /exclusionKind: "policy"/);
  assert.match(lib, /sensitiveReason: observation\.sensitiveReason/);
  assert.match(lib, /Screenshot excluded after sensitive-content detection/);
});

test("gallery list and preview routes keep person scope, gating, and audit", async () => {
  const list = await source("src/app/api/work-os/me/eod/screenshots/route.ts");
  assert.match(list, /requireWorkOsAccess/);
  assert.match(list, /requirePerson: true/);
  assert.match(list, /feature: "screenshot_summaries"/);
  assert.match(list, /date must be YYYY-MM-DD/);
  assert.match(list, /listEodScreenshots/);
  const preview = await source("src/app/api/work-os/evidence/screenshots/[summaryId]/preview/route.ts");
  assert.match(preview, /previewWorkOsScreenshot/);
  assert.match(preview, /feature: "screenshot_summaries"/);
  assert.match(preview, /Cache-Control/);
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /canAccessRawScreenshot/);
  assert.match(lib, /EOD draft review \(own screenshots\)/);
  assert.match(lib, /work_screenshot_access_log/);
  assert.match(lib, /isRetainedScreenshotAvailable/);
  assert.match(lib, /sharp\(/);
});

test("EOD draft observations carry frame ids for inline thumbnails", async () => {
  const aiEod = await source("src/lib/aiEod.ts");
  const aiDraft = await source("src/app/api/work-os/me/eod/ai-draft/route.ts");
  assert.match(aiEod, /summaryId: String\(row\.id\)/);
  assert.match(aiEod, /"id,summary,visible_context,confidence,processing_status,evidence_event_id"/);
  assert.match(aiDraft, /summaryId: string/);
});

console.log("Work OS screenshot gallery tests passed.");
