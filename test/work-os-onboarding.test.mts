import assert from "node:assert/strict";
import test from "node:test";
import { inferArchetype, normalizeProfileItems, validateArchetypeSelection, WORK_ARCHETYPES } from "../src/modules/work-os/onboarding";
import { projectWorktivityAttendance, projectWorktivityAttendanceWithActivity } from "../src/modules/work-os/attendance";

test("catalog exposes eight reviewed employee archetypes", () => {
  assert.equal(WORK_ARCHETYPES.length, 8);
  assert.equal(new Set(WORK_ARCHETYPES.map((entry) => entry.id)).size, 8);
});

test("role inference is deterministic and leaves unmatched titles unassigned", () => {
  assert.equal(inferArchetype("Senior Software Engineer"), "engineering");
  assert.equal(inferArchetype("Customer Service Representative"), "support");
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
  assert.match(projectWorktivityAttendance({ Status: 1, ClockIn: at }, at).message, /clock-in is explicit/);
  assert.equal(projectWorktivityAttendance({ Status: 2, ClockIn: at }, at).state, "paused");
  const idle = projectWorktivityAttendance({ Status: 3, ClockIn: at }, at);
  assert.equal(idle.state, "active");
  assert.doesNotMatch(idle.message, /productive|unproductive/i);
  assert.equal(projectWorktivityAttendance({ Status: 4, ClockOut: at }, at).state, "off_shift");
  assert.equal(projectWorktivityAttendance({ Status: 5 }, at).state, "off_shift");
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
