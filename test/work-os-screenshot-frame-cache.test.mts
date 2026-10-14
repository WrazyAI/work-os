// The Work OS screenshot pipeline feeds the shared frame-analysis cache so a
// later admin audit reuses frames that were already downloaded for recap/EOD
// evidence instead of downloading and fingerprinting them again.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../src/lib/work-os-screenshots.ts", import.meta.url), "utf8");

test("a processed frame records its fingerprint in the shared frame cache", () => {
  assert.match(source, /import \{ fingerprintScreenshot \} from "@\/lib\/worktivityScreenshotRuns";/);
  assert.match(source, /import \{ saveFrameFingerprint \} from "@\/lib\/worktivityFrameCache";/);
  assert.match(source, /await saveFrameFingerprint\(db\(\), \{/);
  assert.match(source, /fingerprint: await fingerprintScreenshot\(bytes\)/);
  assert.match(source, /screenshotId: log\.ID/);
});

test("a cache write failure never fails frame processing", () => {
  assert.match(source, /frame fingerprint cache write failed for \$\{log\.ID\}/);
});

test("both processing entry points pass the Worktivity employee id", () => {
  assert.match(source, /processScreenshotLog\(access, personId, person\.worktivity_employee_id, date, log, config, timezone\)/);
  assert.match(source, /processScreenshotLog\(access, input\.personId, person\.worktivity_employee_id, captureDate, log, config, timezone\)/);
});
