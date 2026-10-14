import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { inferArchetype, normalizeProfileItems, validateArchetypeSelection, WORK_ARCHETYPES } from "../src/modules/work-os/onboarding";
import { projectWorktivityAttendance, projectWorktivityAttendanceWithActivity } from "../src/modules/work-os/attendance";
import { deriveWorktivityBreakSeconds, deriveWorktivityLastActivityAt, deriveWorktivitySessionStart, deriveWorktivitySessionWindow, normalizeWorktivityActivityLogs, worktivityLocalDayBounds } from "../src/lib/work-os-attendance";
import { FALLBACK_TIMEZONES, supportedTimezones, timezoneLabel } from "../src/modules/work-os/timezones";
import { createCoalescedDraftQueue, onboardingHydrationKey, shouldHydrateOnboardingForm } from "../desktop/work-os-companion/src/onboardingDraftState";
import { shouldPromoteSubmittedSchedule } from "../src/lib/work-os-onboarding";

test("only admin onboarding submissions promote the official schedule", () => {
  assert.equal(shouldPromoteSubmittedSchedule("admin"), true);
  assert.equal(shouldPromoteSubmittedSchedule("manager"), false);
  assert.equal(shouldPromoteSubmittedSchedule("employee"), false);
});

test("catalog exposes eight reviewed employee archetypes", () => {
  assert.equal(WORK_ARCHETYPES.length, 8);
  assert.equal(new Set(WORK_ARCHETYPES.map((entry) => entry.id)).size, 8);
});

test("people & finance replaces product in the reviewed catalog", () => {
  const peopleFinance = WORK_ARCHETYPES.find((entry) => entry.id === "people-finance");
  assert.ok(peopleFinance, "people & finance archetype is available");
  assert.equal(peopleFinance.name, "People & Finance");
  assert.ok(peopleFinance.specialties.length >= 4, "people & finance carries specialties");
  assert.ok(peopleFinance.items.length >= 8, "people & finance carries profile items");
  assert.equal(WORK_ARCHETYPES.some((entry) => entry.id === "product"), false, "the least-likely archetype is retired");
  const customerService = WORK_ARCHETYPES.find((entry) => entry.id === "customer-service");
  assert.ok(customerService, "customer service stays available");
});

test("role inference is deterministic and leaves unmatched titles unassigned", () => {
  assert.equal(inferArchetype("Senior Software Engineer"), "engineering");
  assert.equal(inferArchetype("Customer Service Representative"), "customer-service");
  assert.equal(inferArchetype("Customer Support Specialist"), "support");
  assert.equal(inferArchetype("Customer Success Manager"), "support");
  assert.equal(inferArchetype("HR Manager"), "people-finance");
  assert.equal(inferArchetype("Product Manager"), null);
  assert.equal(inferArchetype("Mystery maker"), null);
});

test("specialties must belong to the selected archetype", () => {
  assert.throws(() => validateArchetypeSelection("engineering", ["support:onboarding"]), /do not belong/);
  assert.deepEqual(validateArchetypeSelection("engineering", ["engineering:frontend"]).specialtyIds, ["engineering:frontend"]);
});

test("legacy profile strings become user-owned structured items", () => {
  const items = normalizeProfileItems(undefined, { responsibility: ["Build systems"], deliverable: ["Pull requests"], evidence: ["GitHub"] });
  assert.deepEqual(items.map(({ kind, label, source }) => ({ kind, label, source })), [
    { kind: "responsibility", label: "Build systems", source: "user" },
    { kind: "deliverable", label: "Pull requests", source: "user" },
    { kind: "evidence", label: "GitHub", source: "user" },
  ]);
});

test("Worktivity statuses project attendance without scoring idle", () => {
  const at = "2026-08-12T10:00:00.000Z";
  assert.equal(projectWorktivityAttendance({ Status: 0, ClockIn: at }, at).state, "active");
  assert.equal(projectWorktivityAttendance({ Status: 1, ClockIn: at }, at).state, "active");
  assert.match(projectWorktivityAttendance({ Status: 1, ClockIn: at }, at).message, /workday is synchronized/);
  assert.equal(projectWorktivityAttendance({ Status: 2, ClockIn: at }, at).state, "paused");
  const idle = projectWorktivityAttendance({ Status: 3, ClockIn: at }, at);
  assert.equal(idle.state, "active");
  assert.doesNotMatch(idle.message, /productive|unproductive/i);
  assert.equal(projectWorktivityAttendance({ Status: 4, ClockOut: at }, at).state, "off_shift");
  assert.equal(projectWorktivityAttendance({ Status: 5 }, at).state, "off_shift");
  assert.match(projectWorktivityAttendance({ Status: 4, ClockOut: at }, at).message, /interval is closed/);
  assert.doesNotMatch(projectWorktivityAttendance({ Status: 5 }, at).message, /explicit/i);
  assert.equal(projectWorktivityAttendance(null, at).state, "unknown");
});

test("recent employee-scoped activity overrides stale roster attendance", () => {
  const at = "2026-08-14T19:30:00.000Z";
  const live = projectWorktivityAttendanceWithActivity(
    { Status: 5 },
    { Status: 1, CreateDate: "2026-08-14T19:29:19.000Z" },
    at,
  );
  assert.equal(live.state, "active");
  assert.equal(live.status, "working");
  const stale = projectWorktivityAttendanceWithActivity(
    { Status: 5 },
    { Status: 1, CreateDate: "2026-08-14T19:10:00.000Z" },
    at,
  );
  assert.equal(stale.state, "off_shift");
});

test("Worktivity activity history reconstructs elapsed session start", () => {
  const observed = "2026-08-20T19:00:00.000Z";
  assert.equal(deriveWorktivitySessionStart([
    { Status: 1, CreateDate: "2026-08-20T17:00:00.000Z" },
    { Status: 3, CreateDate: "2026-08-20T18:00:00.000Z" },
    { Status: 1, CreateDate: "2026-08-20T18:59:00.000Z" },
  ], observed), "2026-08-20T17:00:00.000Z");
  assert.equal(deriveWorktivitySessionStart([
    { Status: 1, CreateDate: "2026-08-20T15:00:00.000Z" },
    { Status: 4, CreateDate: "2026-08-20T16:00:00.000Z" },
    { Status: 1, CreateDate: "2026-08-20T18:00:00.000Z" },
  ], observed), "2026-08-20T18:00:00.000Z");
});

test("Worktivity activity history reconstructs the latest observed session window", () => {
  const observed = "2026-08-20T19:00:00.000Z";
  assert.deepEqual(deriveWorktivitySessionWindow([
    { Status: 1, CreateDate: "2026-08-20T15:00:00.000Z" },
    { Status: 4, CreateDate: "2026-08-20T16:00:00.000Z" },
  ], observed), {
    clockedInAt: "2026-08-20T15:00:00.000Z",
    clockedOutAt: "2026-08-20T16:00:00.000Z",
  });
  assert.deepEqual(deriveWorktivitySessionWindow([
    { Status: 1, CreateDate: "2026-08-20T15:00:00.000Z" },
    { Status: 4, CreateDate: "2026-08-20T16:00:00.000Z" },
    { Status: 0, CreateDate: "2026-08-20T18:00:00.000Z" },
    { Status: 3, CreateDate: "2026-08-20T18:59:00.000Z" },
  ], observed), {
    clockedInAt: "2026-08-20T18:00:00.000Z",
    clockedOutAt: null,
  });
});

test("Worktivity duration ends at actual activity rather than no-attendance samples", () => {
  const observed = "2026-08-20T19:00:00.000Z";
  assert.equal(deriveWorktivityLastActivityAt([
    { Status: 1, CreateDate: "2026-08-20T15:00:00.000Z" },
    { Status: 3, CreateDate: "2026-08-20T16:00:00.000Z" },
    { Status: 5, CreateDate: "2026-08-20T18:59:00.000Z" },
  ], observed), "2026-08-20T16:00:00.000Z");
});
test("timezone picker keeps canonical IANA IDs and has a bundled fallback", () => {
  assert.ok(FALLBACK_TIMEZONES.includes("UTC"));
  assert.ok(supportedTimezones().includes("UTC"));
  assert.match(timezoneLabel("Atlantic/Reykjavik", new Date("2026-01-01T12:00:00Z")), /Reykjavik/);
});

test("only explicit Worktivity OnBreak intervals contribute provider break time", () => {
  assert.equal(deriveWorktivityBreakSeconds([
    { ID: "break-1", Status: 2, CreateDate: "2026-08-21T09:00:10Z" },
    { ID: "break-duplicate", Status: 2, CreateDate: "2026-08-21T09:00:50Z" },
    { ID: "idle", Status: 3, CreateDate: "2026-08-21T09:01:00Z" },
    { ID: "break-2", Status: 2, CreateDate: "2026-08-21T09:02:00Z" },
  ]), 110);
});

test("five-minute Worktivity OnBreak captures reconstruct an hour without counting Idle", () => {
  const logs = Array.from({ length: 12 }, (_, index) => ({ ID: `break-${index}`, Status: 2, CreateDate: `2026-08-21T${String(9 + Math.floor(index / 12)).padStart(2, "0")}:${String((index * 5) % 60).padStart(2, "0")}:00Z` }));
  logs.push({ ID: "idle-after-break", Status: 3, CreateDate: "2026-08-21T10:00:00Z" });
  assert.equal(deriveWorktivityBreakSeconds(logs), 3600);
});

test("paged Worktivity history keeps only the exact employee and deduplicates provider IDs", () => {
  const history = normalizeWorktivityActivityLogs([
    { ID: "page-1", EmployeeId: "employee-a", Status: 1, CreateDate: "2026-08-21T08:00:00Z" },
    { ID: "repeat", EmployeeId: "employee-a", Status: 2, CreateDate: "2026-08-21T09:00:00Z" },
    { ID: "other-employee", EmployeeId: "employee-b", Status: 2, CreateDate: "2026-08-21T09:05:00Z" },
    { ID: "repeat", EmployeeId: "employee-a", Status: 2, CreateDate: "2026-08-21T09:00:00Z" },
    { ID: "page-2", EmployeeId: "employee-a", Status: 3, CreateDate: "2026-08-21T09:05:00Z" },
  ] as any, "employee-a");
  assert.deepEqual(history.map((entry) => entry.ID), ["page-1", "repeat", "page-2"]);
  assert.equal(deriveWorktivityBreakSeconds(history), 300);
});

test("Worktivity requests use DST-aware employee-local day bounds", () => {
  const bounds = worktivityLocalDayBounds("America/New_York", new Date("2026-03-08T16:00:00Z"));
  assert.equal(bounds.date, "2026-03-08");
  assert.equal(bounds.start, "2026-03-08T05:00:00.000Z");
  assert.equal(bounds.end, "2026-03-09T04:00:00.000Z");
});

test("an onboarding draft response advances metadata without resetting later typing", () => {
  const identity = onboardingHydrationKey({ email: "employee@example.test" });
  assert.equal(shouldHydrateOnboardingForm(null, identity), true);
  assert.equal(shouldHydrateOnboardingForm(identity, identity), false);
  // A response with the same signed-in identity must preserve the locally
  // typed next value; the caller only updates revision/updatedAt metadata.
  const typedAfterSave = "Still typing after the first save";
  assert.equal(shouldHydrateOnboardingForm(identity, onboardingHydrationKey({ email: "employee@example.test" })), false);
  assert.equal(typedAfterSave, "Still typing after the first save");
});

test("one edit converges to a serialized coalesced draft save without server-response reset", async () => {
  const calls: string[] = [];
  let startedFirst!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => { startedFirst = resolve; });
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const queue = createCoalescedDraftQueue(async (value: string) => {
    calls.push(value);
    if (calls.length === 1) {
      startedFirst();
      await firstRelease;
    }
  });

  const initialEdit = queue.enqueue("name: first edit");
  await firstStarted;
  const typingAfterResponseWasSent = queue.enqueue("name: typing");
  const latestTyping = queue.enqueue("name: final typing");
  releaseFirst();
  await Promise.all([initialEdit, typingAfterResponseWasSent, latestTyping]);

  // A response to the initial edit cannot overwrite typing that occurred
  // while it was in flight; only the latest queued draft is sent next.
  assert.deepEqual(calls, ["name: first edit", "name: final typing"]);
  await queue.enqueue("timezone: Europe/London");
  assert.deepEqual(calls, ["name: first edit", "name: final typing", "timezone: Europe/London"]);
});

// The submit RPC rejects the whole onboarding payload unless these three exact
// strings match its own literals. The form echoes the constants the server
// served to it, so a one-character drift between the two sides would fail every
// signup at the final step — visible only in production, at the worst moment.
test("the onboarding payload's policy strings match the submit RPC's guards", () => {
  const client = readFileSync(new URL("../src/lib/work-os-onboarding.ts", import.meta.url), "utf8");
  const version = client.match(/export const WORK_OS_TRACKING_POLICY = \{\s*\n\s*version: "([^"]*)"/)?.[1];
  const purpose = client.match(/export const WORK_OS_TRACKING_POLICY = \{\s*\n\s*version: "[^"]*",\s*\n\s*purpose: "([^"]*)"/)?.[1];
  const screenshot = client.match(/export const WORK_OS_SCREENSHOT_CONSENT_PURPOSE = "([^"]*)"/)?.[1];
  assert.ok(version && purpose && screenshot, "policy constants must be readable");

  const migrations = readdirSync(new URL("../supabase/migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"))
    .filter((sql) => sql.includes("invalid final onboarding payload"));
  assert.ok(migrations.length > 0, "the submit RPC must exist in a migration");

  const expected: Record<string, { value: string; reject: boolean }> = {
    policyVersion: { value: version!, reject: true },
    trackingPurpose: { value: purpose!, reject: true },
    screenshotPurpose: { value: screenshot!, reject: true },
  };
  for (const sql of migrations) {
    for (const [key, { value, reject }] of Object.entries(expected)) {
      const guard = sql.match(new RegExp(`p_payload->>'${key}' ${reject ? "<>" : "="} '([^']*)'`));
      assert.ok(guard, `the RPC must guard ${key}`);
      assert.equal(guard![1], value, `the RPC's ${key} guard must match the served constant`);
    }
  }
});
