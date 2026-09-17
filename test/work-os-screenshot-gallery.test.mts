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

test("EOD activity context is hourly, not per frame", async () => {
  const aiEod = await source("src/lib/aiEod.ts");
  const aiDraft = await source("src/app/api/work-os/me/eod/ai-draft/route.ts");
  assert.match(aiEod, /ensureHourlyScreenshotSummaries/);
  assert.match(aiEod, /type EodScreenshotHour/);
  assert.match(aiEod, /hours/);
  assert.match(aiDraft, /screenshots\.hours\.map/);
  assert.match(aiDraft, /hour\.label/);
});

test("the gallery reports pending and total frames honestly", async () => {
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /pending: number;/);
  assert.match(lib, /total: number;/);
  assert.match(lib, /gallery\.total = ids\.length;/);
  assert.match(lib, /gallery\.pending = ids\.filter\(\(id\) => !terminal\.has\(id\)\)\.length;/);
  const galleryReturn = lib.slice(lib.indexOf("export async function listEodScreenshots"), lib.indexOf("export type ScreenshotPreviewSize"));
  assert.match(galleryReturn, /processing_status === "failed"\) \{ gallery\.unavailable \+= 1; continue; \}/, "failed frames stay unavailable and pending");
  const aiEod = await source("src/lib/aiEod.ts");
  assert.match(aiEod, /const pending = ids\.filter\(\(id\) => !terminal\.has\(id\)\)\.length;/);
  assert.match(aiEod, /failed: count\("failed"\), pending, hours/);
});

test("the prepare route is self-scoped, gated, and bounded", async () => {
  const prepare = await source("src/app/api/work-os/me/eod/screenshots/prepare/route.ts");
  assert.match(prepare, /prepareEodScreenshots/);
  assert.match(prepare, /requireWorkOsAccess/);
  assert.match(prepare, /requirePerson: true/);
  assert.match(prepare, /feature: "screenshot_summaries"/);
  assert.match(prepare, /date must be YYYY-MM-DD/);
  assert.match(prepare, /max_frames/);
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /export async function prepareEodScreenshots/);
  assert.match(lib, /PREPARE_SCREENSHOTS_PER_REQUEST = 6/);
  assert.match(lib, /const prepareInFlight = new Map<string, Promise<EodPreparation>>\(\)/);
  assert.match(lib, /if \(existing\) return existing;/, "concurrent calls share one batch");
  assert.match(lib, /action: "screenshot\.on_demand_prepared"/);
  assert.doesNotMatch(lib.slice(lib.indexOf("export async function prepareEodScreenshots"), lib.indexOf("export async function runScheduledScreenshotAnalysis")), /screenshot\.eod_completed/, "interactive preparation never settles the scheduled day ledger");
});

test("interactive runs bound their provider calls", async () => {
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /SCREENSHOT_DOWNLOAD_TIMEOUT_MS/);
  assert.match(lib, /SCREENSHOT_VISION_TIMEOUT_MS/);
  assert.match(lib, /AbortSignal\.timeout\(SCREENSHOT_DOWNLOAD_TIMEOUT_MS\)/);
  assert.match(lib, /AbortSignal\.timeout\(SCREENSHOT_VISION_TIMEOUT_MS\)/);
});

console.log("Work OS screenshot gallery tests passed.");
