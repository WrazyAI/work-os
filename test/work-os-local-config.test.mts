import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWorkOsLocalConfig,
  parseWorkOsLocalConfig,
  personCadenceOverride,
  resolveWorkOsCadence,
  workOsLocalConfigPath,
} from "../src/lib/work-os-local-config";

test("local config parsing keeps only bounded cadence entries", () => {
  const config = parseWorkOsLocalConfig(JSON.stringify({
    people: {
      "david@maigreeks.com": { checkInIntervalMinutes: 10, firstFollowUpMinutes: 10 },
      "below-floor@example.com": { checkInIntervalMinutes: 4 },
      "partial@example.com": { firstFollowUpMinutes: 30 },
      "bad@example.com": { checkInIntervalMinutes: "nope" },
      "UPPER@Example.com": { checkInIntervalMinutes: 20 },
      "": { checkInIntervalMinutes: 10 },
    },
    unknownKey: true,
  }));
  assert.deepEqual(config.people, {
    "david@maigreeks.com": { checkInIntervalMinutes: 10, firstFollowUpMinutes: 10 },
    "partial@example.com": { firstFollowUpMinutes: 30 },
    "upper@example.com": { checkInIntervalMinutes: 20 },
  });
  assert.deepEqual(parseWorkOsLocalConfig("{not json"), { people: {} });
  assert.deepEqual(parseWorkOsLocalConfig("[]"), { people: {} });
});

test("person overrides match by id or email, case-insensitively", () => {
  const config = parseWorkOsLocalConfig(JSON.stringify({
    people: {
      "david@maigreeks.com": { checkInIntervalMinutes: 10 },
      "8772f360-f816-4914-9b99-849bdc573cb5": { firstFollowUpMinutes: 15 },
    },
  }));
  assert.deepEqual(personCadenceOverride(config, { email: "David@Maigreeks.com" }), { checkInIntervalMinutes: 10 });
  assert.deepEqual(personCadenceOverride(config, { personId: "8772f360-f816-4914-9b99-849bdc573cb5" }), { firstFollowUpMinutes: 15 });
  assert.equal(personCadenceOverride(config, { email: "nobody@example.com" }), null);
});

test("resolved cadence prefers the local entry, then the environment, then defaults", () => {
  const config = parseWorkOsLocalConfig(JSON.stringify({
    people: { "david@maigreeks.com": { checkInIntervalMinutes: 10 } },
  }));
  const env = { WORK_OS_CHECK_IN_INTERVAL_MINUTES: "30", WORK_OS_FIRST_FOLLOW_UP_MINUTES: "45" } as NodeJS.ProcessEnv;
  assert.deepEqual(resolveWorkOsCadence({ email: "david@maigreeks.com" }, env, config), {
    checkInIntervalMinutes: 10,
    firstFollowUpMinutes: 45,
    personOverride: true,
  });
  assert.deepEqual(resolveWorkOsCadence({ email: "other@example.com" }, env, config), {
    checkInIntervalMinutes: 30,
    firstFollowUpMinutes: 45,
    personOverride: false,
  });
  assert.deepEqual(resolveWorkOsCadence({ email: "other@example.com" }, {} as NodeJS.ProcessEnv, config), {
    checkInIntervalMinutes: 60,
    firstFollowUpMinutes: 75,
    personOverride: false,
  });
  // Invalid environment values fall back to the defaults.
  assert.deepEqual(resolveWorkOsCadence({ email: "other@example.com" }, { WORK_OS_CHECK_IN_INTERVAL_MINUTES: "4" } as NodeJS.ProcessEnv, config), {
    checkInIntervalMinutes: 60,
    firstFollowUpMinutes: 75,
    personOverride: false,
  });
  // A first-follow-up-only entry still counts as a person override.
  const partial = parseWorkOsLocalConfig(JSON.stringify({ people: { "partial@example.com": { firstFollowUpMinutes: 15 } } }));
  assert.deepEqual(resolveWorkOsCadence({ email: "partial@example.com" }, {} as NodeJS.ProcessEnv, partial), {
    checkInIntervalMinutes: 60,
    firstFollowUpMinutes: 15,
    personOverride: true,
  });
});

test("the config file is read from the checkout and refreshes when it changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-os-config-"));
  const path = join(dir, "work-os.local.json");
  writeFileSync(path, JSON.stringify({ people: { "a@b.com": { checkInIntervalMinutes: 10 } } }));
  assert.deepEqual(loadWorkOsLocalConfig(path).people["a@b.com"], { checkInIntervalMinutes: 10 });
  // Rewrite and bump the mtime so the mtime/size cache refreshes.
  writeFileSync(path, JSON.stringify({ people: { "a@b.com": { checkInIntervalMinutes: 15 } } }));
  const future = new Date(Date.now() + 5_000);
  utimesSync(path, future, future);
  assert.deepEqual(loadWorkOsLocalConfig(path).people["a@b.com"], { checkInIntervalMinutes: 15 });
  assert.deepEqual(loadWorkOsLocalConfig(join(dir, "missing.json")), { people: {} });
  // A configured path resolves relative to the checkout.
  assert.equal(workOsLocalConfigPath({ WORK_OS_LOCAL_CONFIG_PATH: "custom/local.json" } as NodeJS.ProcessEnv), join(process.cwd(), "custom/local.json"));
});
