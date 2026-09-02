import assert from "node:assert/strict";
import test from "node:test";
import { checkInIntervalMs, decideWorkdayPrompt, dedupePlanCandidates, nextSessionState, suppressPromptForSubmittedEod } from "../src/modules/work-os/workday";

const session = {
  state: "active" as const,
  scheduledStartsAt: "2026-08-12T09:00:00.000Z",
  scheduledEndsAt: "2026-08-12T17:00:00.000Z",
  clockedInAt: "2026-08-12T09:00:00.000Z",
};

test("session transitions reject impossible branches", () => {
  assert.equal(nextSessionState("scheduled", "clock_in"), "clocked_in");
  assert.equal(nextSessionState("clocked_in", "pause"), "paused");
  assert.equal(nextSessionState("paused", "resume"), "active");
  assert.equal(nextSessionState("active", "clock_out"), "clocked_out");
  assert.throws(() => nextSessionState("clocked_out", "pause"));
});

test("prompt contract is planless and suppresses breaks, final hour, and post clock-out", () => {
  const firstPrompt = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: false, at: "2026-08-12T09:05:00.000Z" });
  assert.equal(firstPrompt.kind, "follow_up");
  assert.equal(firstPrompt.nextPromptAt, "2026-08-12T09:05:00.000Z");
  assert.equal(decideWorkdayPrompt({ session, breaks: [{ startsAt: "2026-08-12T12:00:00.000Z", endsAt: "2026-08-12T12:30:00.000Z" }], hasConfirmedPlan: true, at: "2026-08-12T12:05:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:15:00.000Z" }).kind, null);
  assert.equal(decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:51:00.000Z" }).kind, "eod");
  assert.equal(decideWorkdayPrompt({ session: { ...session, state: "clocked_out" }, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T18:00:00.000Z" }).kind, null);
});

test("check-in cadence defaults to five minutes and accepts bounded configuration", () => {
  assert.equal(checkInIntervalMs(undefined), 5 * 60_000);
  assert.equal(checkInIntervalMs("15"), 15 * 60_000);
  assert.equal(checkInIntervalMs("0"), 5 * 60_000);
  assert.equal(checkInIntervalMs("241"), 5 * 60_000);
});

test("a submitted EOD suppresses any remaining workday prompt", () => {
  const due = decideWorkdayPrompt({ session, breaks: [], hasConfirmedPlan: true, at: "2026-08-12T16:51:00.000Z" });
  assert.deepEqual(suppressPromptForSubmittedEod(due, "2026-08-12T16:55:00.000Z"), {
    kind: null,
    nextPromptAt: null,
    required: false,
    reason: "EOD submitted.",
  });
});

test("a substantive response schedules the next configured check-in", () => {
  const prompt = decideWorkdayPrompt({
    session: { ...session, lastPromptKind: "follow_up", lastPromptAt: "2026-08-12T09:05:00.000Z" },
    breaks: [],
    lastPromptKind: "follow_up",
    lastPromptAt: "2026-08-12T09:05:00.000Z",
    lastSubstantiveUpdateAt: "2026-08-12T09:07:00.000Z",
    at: "2026-08-12T09:12:00.000Z",
  });
  assert.equal(prompt.kind, "hourly_fallback");
  assert.equal(prompt.nextPromptAt, "2026-08-12T09:12:00.000Z");
});

test("daily plan candidates deduplicate provider and local tasks", () => {
  assert.deepEqual(dedupePlanCandidates([{ id: "a", title: "A" }, { id: "a", title: "A duplicate" }, { provider_task_id: "b", title: "B" }]).map((item) => item.title), ["A", "B"]);
});
