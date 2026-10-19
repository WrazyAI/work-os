import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the activity prompt asks for short lines that lead with their clock time", () => {
  const source = read("src/lib/work-os-activity-intervals.ts");
  assert.match(source, /One observable activity in at most 10 words, led by its clock time when known/);
  assert.match(source, /Name one thing, never two, and no counts, tool brands, or file paths\./);
});

test("the capability is named for both directions wherever it is configured", () => {
  for (const path of ["src/modules/work-os/admin/AdminSettings.tsx", "desktop/work-os-companion/src/admin/SettingsPage.tsx"]) {
    const source = read(path);
    assert.match(source, /key: "voice_input", label: "Voice input & output"/, path);
    assert.match(source, /hear recaps read back/, path);
    assert.equal(/label: "Voice input"/.test(source), false, `${path} still carries the old label`);
  }
  // The flag key itself never changes, so existing organisations keep their setting.
  assert.match(read("src/lib/work-os-readiness.ts"), /voice_input: asFlag\(flags\.voice_input\)/);
});

test("the readiness line names both directions", () => {
  assert.match(read("src/lib/work-os-readiness.ts"), /required for Work OS voice input and for reading recaps aloud/);
});
