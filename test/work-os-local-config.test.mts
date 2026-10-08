import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWorkOsLocalConfig,
  parseWorkOsLocalConfig,
  personCadenceOverride,
  resolveLocalConfigPath,
  resolveWorkOsCadence,
  workOsLocalConfigPath,
} from "../src/lib/work-os-local-config";
import { checkInIntervalOption, firstFollowUpOption } from "../src/modules/work-os/workday";

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

test("the local config path resolves the same value on macOS, Linux, and Windows", () => {
  const mac = { cwd: "/Users/david/work-os", home: "/Users/david", flavor: "posix" } as const;
  const win = { cwd: "C:\\work\\work-os", home: "C:\\Users\\David", flavor: "win32" } as const;

  // The default lives with the checkout, so it resolves against the working
  // directory on every platform.
  assert.equal(workOsLocalConfigPath({} as NodeJS.ProcessEnv, mac), "/Users/david/work-os/config/work-os.local.json");
  assert.equal(workOsLocalConfigPath({} as NodeJS.ProcessEnv, win), "C:\\work\\work-os\\config\\work-os.local.json");

  // `~` is how an operator points at a file in their own account.
  assert.equal(workOsLocalConfigPath({ WORK_OS_LOCAL_CONFIG_PATH: "~/.work-os.local.json" } as NodeJS.ProcessEnv, mac), "/Users/david/.work-os.local.json");
  assert.equal(workOsLocalConfigPath({ WORK_OS_LOCAL_CONFIG_PATH: "~" } as NodeJS.ProcessEnv, mac), "/Users/david");
  assert.equal(workOsLocalConfigPath({ WORK_OS_LOCAL_CONFIG_PATH: "~\\work-os.local.json" } as NodeJS.ProcessEnv, win), "C:\\Users\\David\\work-os.local.json");

  // A relative path follows the platform's separator either way.
  assert.equal(workOsLocalConfigPath({ WORK_OS_LOCAL_CONFIG_PATH: "config\\work-os.local.json" } as NodeJS.ProcessEnv, mac), "/Users/david/work-os/config/work-os.local.json");
  assert.equal(workOsLocalConfigPath({ WORK_OS_LOCAL_CONFIG_PATH: "config/work-os.local.json" } as NodeJS.ProcessEnv, win), "C:\\work\\work-os\\config\\work-os.local.json");

  // A Windows path stays rooted on macOS/Linux instead of being joined to the
  // working directory — a value that cannot exist must not look like a real one.
  assert.equal(resolveLocalConfigPath("C:\\Users\\David\\work-os.local.json", mac), "C:/Users/David/work-os.local.json");
  assert.equal(resolveLocalConfigPath("\\\\server\\share\\work-os.local.json", mac), "//server/share/work-os.local.json");
  assert.equal(resolveLocalConfigPath("C:\\Users\\David\\work-os.local.json", win), "C:\\Users\\David\\work-os.local.json");

  // A POSIX absolute path is left alone wherever it is honored.
  assert.equal(resolveLocalConfigPath("/etc/work-os.local.json", mac), "/etc/work-os.local.json");
  assert.equal(workOsLocalConfigPath({ WORK_OS_LOCAL_CONFIG_PATH: "  /etc/work-os.local.json  " } as NodeJS.ProcessEnv, mac), "/etc/work-os.local.json");
});

test("an unreadable configured override is reported instead of disappearing", () => {
  const previous = process.env.WORK_OS_LOCAL_CONFIG_PATH;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => { warnings.push(String(message)); };
  process.env.WORK_OS_LOCAL_CONFIG_PATH = "configured/nowhere.json";
  try {
    const missing = join(tmpdir(), "work-os-config-missing", "work-os.local.json");
    assert.deepEqual(loadWorkOsLocalConfig(missing), { people: {} });
    // A second read does not repeat itself.
    assert.deepEqual(loadWorkOsLocalConfig(missing), { people: {} });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /cannot be read/);
    assert.match(warnings[0]!, /WORK_OS_LOCAL_CONFIG_PATH/);
  } finally {
    console.warn = originalWarn;
    if (previous === undefined) delete process.env.WORK_OS_LOCAL_CONFIG_PATH;
    else process.env.WORK_OS_LOCAL_CONFIG_PATH = previous;
  }
});

test("the override path resolves the same way on macOS, Linux, and Windows", () => {
  const posix = { flavor: "posix" as const, cwd: "/srv/work-os", home: "/Users/david" };
  const win = { flavor: "win32" as const, cwd: "C:\\work-os", home: "C:\\Users\\david" };

  // Default: relative to the checkout, on either runtime.
  assert.equal(resolveLocalConfigPath("config/work-os.local.json", posix), "/srv/work-os/config/work-os.local.json");
  assert.equal(resolveLocalConfigPath("config/work-os.local.json", win), "C:\\work-os\\config\\work-os.local.json");

  // Backslashes typed on macOS/Linux are still separators, not literal name text.
  assert.equal(resolveLocalConfigPath("config\\work-os.local.json", posix), "/srv/work-os/config/work-os.local.json");

  // Absolute paths are used as given.
  assert.equal(resolveLocalConfigPath("/etc/work-os.local.json", posix), "/etc/work-os.local.json");
  assert.equal(resolveLocalConfigPath("D:\\config\\work-os.local.json", win), "D:\\config\\work-os.local.json");

  // `~` means the operator's home directory on every runtime.
  assert.equal(resolveLocalConfigPath("~/work-os.local.json", posix), "/Users/david/work-os.local.json");
  assert.equal(resolveLocalConfigPath("~", posix), "/Users/david");
  assert.equal(resolveLocalConfigPath("~\\work-os.local.json", win), "C:\\Users\\david\\work-os.local.json");

  // A Windows path must never be glued onto a macOS/Linux working directory:
  // that produced a path which could not exist and silently dropped the override.
  assert.equal(resolveLocalConfigPath("C:\\Users\\david\\work-os.local.json", posix), "C:/Users/david/work-os.local.json");
  assert.equal(resolveLocalConfigPath("\\\\server\\share\\work-os.local.json", posix), "//server/share/work-os.local.json");

  // The environment override flows through the same resolution.
  assert.equal(
    workOsLocalConfigPath({ WORK_OS_LOCAL_CONFIG_PATH: "~/override.json" } as NodeJS.ProcessEnv, posix),
    "/Users/david/override.json",
  );
});

test("the installed app's own config file wins over every deployment source", () => {
  const identity = { email: "david@maigreeks.com" };
  const config = parseWorkOsLocalConfig(JSON.stringify({ people: { "david@maigreeks.com": { checkInIntervalMinutes: 30, firstFollowUpMinutes: 10 } } }));
  const env = { WORK_OS_CHECK_IN_INTERVAL_MINUTES: "45", WORK_OS_FIRST_FOLLOW_UP_MINUTES: "45" } as NodeJS.ProcessEnv;

  // The machine's file is what an employee edited, so it is the most specific
  // source there is.
  assert.deepEqual(
    resolveWorkOsCadence(identity, env, config, { checkInIntervalMinutes: 10, firstFollowUpMinutes: 10 }),
    { checkInIntervalMinutes: 10, firstFollowUpMinutes: 10, personOverride: true },
  );

  // A file that names only one value leaves the other to the deployment.
  assert.deepEqual(
    resolveWorkOsCadence(identity, env, config, { checkInIntervalMinutes: 15 }),
    { checkInIntervalMinutes: 15, firstFollowUpMinutes: 10, personOverride: true },
  );

  // Without a machine value the deployment entry still applies.
  assert.deepEqual(
    resolveWorkOsCadence(identity, env, config, null),
    { checkInIntervalMinutes: 30, firstFollowUpMinutes: 10, personOverride: true },
  );

  // An empty machine object is not an override.
  assert.deepEqual(
    resolveWorkOsCadence(identity, env, config, {}),
    { checkInIntervalMinutes: 30, firstFollowUpMinutes: 10, personOverride: true },
  );

  // Someone with no entry anywhere still lands on the environment, then defaults.
  assert.deepEqual(
    resolveWorkOsCadence({ email: "someone-else@example.com" }, env, config, null),
    { checkInIntervalMinutes: 45, firstFollowUpMinutes: 45, personOverride: false },
  );
  assert.deepEqual(
    resolveWorkOsCadence({ email: "someone-else@example.com" }, {} as NodeJS.ProcessEnv, config, null),
    { checkInIntervalMinutes: 60, firstFollowUpMinutes: 75, personOverride: false },
  );
});

test("a machine cadence outside the bounds is ignored by the request layer", () => {
  // Bounds live next to the cadence contract and are shared by every source, so
  // an over-eager local edit cannot storm or silence a workday.
  assert.equal(checkInIntervalOption("240"), 240);
  assert.equal(checkInIntervalOption("241"), null);
  assert.equal(checkInIntervalOption("4"), null);
  assert.equal(checkInIntervalOption("not-a-number"), null);
  assert.equal(firstFollowUpOption("240"), 240);
  assert.equal(firstFollowUpOption("241"), null);
  // Absent headers resolve to nothing rather than a bogus cadence.
  assert.equal(checkInIntervalOption(null), null);
  assert.equal(firstFollowUpOption(null), null);
});
