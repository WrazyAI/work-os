import { describe, expect, it } from "vitest";
import {
  clockInNudge, clockInAlertDue, collectNudges, composerSendTarget, composerVisible, bubbleAction, eodAlertDue, eodNudge, hasOpenShiftSession, hourlyNudge, isHeaderDragStart, isOnShift, isPromptReminderTurn, mergeAvatarChatEntries, mergeConversationTurns, mergeNextStepsMoment, nextStepState, nextStepsSettleMs, prunePromptReminderTurns, replaceUndecidedRecapTurns, scheduledShiftEnd, serializeAvatarChatEntry, stripPromptReminderTurns,
  NEXT_STEPS_SETTLE_MS,
  avatarBubble, avatarPrompt, clearRecordedUpdatePrompt, nextSnoozeDelayMs, shiftElapsedFraction, snoozeUntil,
  agendaAutoExpandKey, nextAgendaAutoExpand, overdueTasks,
  type CompanionDayFacts,
} from "./avatarLogic";
import type { RecapNextStepsMoment } from "./RecapNextStepsCard";

const NOW = new Date("2026-08-31T10:00:00Z").getTime();
const base: CompanionDayFacts = {
  shiftDate: "2026-08-31",
  promptRequired: false,
  nextPromptAt: null,
  shiftStartsAt: "2026-08-31T08:00:00Z",
  shiftEndsAt: "2026-08-31T16:00:00Z",
  sessionState: "active",
  clockedInAt: "2026-08-31T08:05:00Z",
  clockedOutAt: null,
  pausedSeconds: 0,
};

describe("isOnShift", () => {
  it("is true while clocked in and not paused", () => {
    expect(isOnShift(base, NOW)).toBe(true);
  });
  it("is false when clocked out, paused, or never clocked in", () => {
    expect(isOnShift({ ...base, clockedOutAt: "2026-08-31T09:00:00Z" }, NOW)).toBe(false);
    expect(isOnShift({ ...base, sessionState: "paused" }, NOW)).toBe(false);
    expect(isOnShift({ ...base, clockedInAt: null }, NOW)).toBe(false);
  });
});

describe("hasOpenShiftSession", () => {
  it("keeps a paused open session eligible for the elapsed-time display", () => {
    expect(hasOpenShiftSession({ ...base, sessionState: "paused" })).toBe(true);
  });
  it("hides the shift display after clock-out or EOD", () => {
    expect(hasOpenShiftSession({ ...base, clockedOutAt: "2026-08-31T09:00:00Z" })).toBe(false);
    expect(hasOpenShiftSession({ ...base, eodSubmitted: true })).toBe(false);
  });
});

describe("composerVisible", () => {
  it("keeps the composer while the EOD alert is live and the session is open", () => {
    expect(composerVisible(base, "open_eod")).toBe(true);
    expect(composerVisible({ ...base, sessionState: "paused" }, "open_eod")).toBe(true);
  });
  it("hands the moment to the EOD page after clock-out or submission", () => {
    expect(composerVisible({ ...base, sessionState: "clocked_out", clockedOutAt: "2026-08-31T16:05:00Z" }, "open_eod")).toBe(false);
    expect(composerVisible({ ...base, eodSubmitted: true }, "open_eod")).toBe(false);
  });
  it("never hides the composer for other prompts", () => {
    expect(composerVisible({ ...base, sessionState: "clocked_out", clockedOutAt: "2026-08-31T16:05:00Z" }, null)).toBe(true);
  });
});

describe("hourly nudge", () => {
  it("fires once per prompt instance while required and on shift", () => {
    const facts = { ...base, promptRequired: true, nextPromptAt: "2026-08-31T10:00:00Z" };
    const nudge = hourlyNudge(facts, NOW, new Set());
    expect(nudge?.kind).toBe("hourly");
    const seen = new Set([nudge!.key]);
    expect(hourlyNudge(facts, NOW + 1000, seen)).toBeNull();
  });
  it("keeps the due prompt to the last update and the question", () => {
    const facts = {
      ...base,
      promptRequired: true,
      promptKind: "hourly_fallback" as const,
      nextPromptAt: "2026-08-31T10:00:00Z",
      timezone: "UTC",
      lastSubstantiveUpdateAt: "2026-08-31T09:20:00Z",
      planIntent: "Finish the companion approval flow",
      completedTasks: 1,
      openTasks: 2,
    };
    const nudge = hourlyNudge(facts, NOW, new Set());
    expect(nudge?.title).toBe("Check-in due");
    expect(nudge?.body).toContain("9:20 AM");
    expect(nudge?.body).toContain("What's changed since then?");
    // The banner no longer repeats the focus and the task counts.
    expect(nudge?.body).not.toContain("Finish the companion approval flow");
    expect(nudge?.body).not.toContain("Today's focus");
    expect(nudge?.body).not.toContain("Current task state");
    expect(nudge?.body).not.toContain("1 completed and 2 open tasks");
  });
  it("never fires off shift", () => {
    const facts = { ...base, promptRequired: true, clockedInAt: null };
    expect(hourlyNudge(facts, NOW, new Set())).toBeNull();
  });
  it("waits until the server-scheduled prompt time", () => {
    const facts = { ...base, promptRequired: true, nextPromptAt: "2026-08-31T10:05:00Z" };
    expect(hourlyNudge(facts, NOW, new Set())).toBeNull();
  });
});

describe("overdue work", () => {
  const facts: CompanionDayFacts = {
    ...base,
    taskOptions: [
      { id: "t-1", title: "Repair provider sync", dueDate: "2026-08-29", completed: false },
      { id: "t-2", title: "Due today", dueDate: "2026-08-31", completed: false },
      { id: "t-3", title: "Done late", dueDate: "2026-08-29", completed: true },
      { id: "t-4", title: "No due date", dueDate: null, completed: false },
      { id: "t-5", title: "Future", dueDate: "2026-09-02", completed: false },
    ],
  };

  it("uses the one overdue definition every surface shares", () => {
    expect(overdueTasks(facts).map((task) => task.id)).toEqual(["t-1"]);
    expect(overdueTasks({ ...base, taskOptions: undefined })).toEqual([]);
    expect(overdueTasks({ ...base, taskOptions: [] })).toEqual([]);
  });

  it("leads the check-in prompt with the overdue count", () => {
    const due: CompanionDayFacts = { ...facts, promptRequired: true, promptKind: "hourly_fallback", nextPromptAt: "2026-08-31T09:59:00Z" };
    const prompt = avatarPrompt(due, NOW);
    expect(prompt.kind).toBe("check_in");
    expect(prompt.body).toBe("1 task is overdue. Record what changed since your last update.");
    const clean = avatarPrompt({ ...base, promptRequired: true, promptKind: "hourly_fallback", nextPromptAt: "2026-08-31T09:59:00Z" }, NOW);
    expect(clean.body).not.toContain("overdue");
  });
});

describe("clock-in nudge", () => {
  it("fires within 15 minutes of the scheduled start when not clocked in", () => {
    const facts: CompanionDayFacts = { ...base, clockedInAt: null, sessionState: "scheduled" };
    const at = new Date("2026-08-31T08:10:00Z").getTime();
    expect(clockInNudge(facts, at, new Set())?.kind).toBe("clock_in");
  });
  it("does not fire 30 minutes after start", () => {
    const facts: CompanionDayFacts = { ...base, clockedInAt: null, sessionState: "scheduled" };
    const at = new Date("2026-08-31T08:30:00Z").getTime();
    expect(clockInNudge(facts, at, new Set())).toBeNull();
  });
});

describe("clockInAlertDue", () => {
  it("opens at the scheduled start and closes after fifteen minutes", () => {
    const facts: CompanionDayFacts = { ...base, clockedInAt: null, sessionState: "scheduled" };
    expect(clockInAlertDue(facts, new Date("2026-08-31T07:59:00Z").getTime())).toBe(false);
    expect(clockInAlertDue(facts, new Date("2026-08-31T08:00:30Z").getTime())).toBe(true);
    expect(clockInAlertDue(facts, new Date("2026-08-31T08:15:00Z").getTime())).toBe(true);
    expect(clockInAlertDue(facts, new Date("2026-08-31T08:16:00Z").getTime())).toBe(false);
  });
  it("stays closed once clocked in or clocked out", () => {
    const at = new Date("2026-08-31T08:05:00Z").getTime();
    expect(clockInAlertDue({ ...base, clockedInAt: "2026-08-31T08:02:00Z" }, at)).toBe(false);
    expect(clockInAlertDue({ ...base, clockedInAt: null, sessionState: "clocked_out" }, at)).toBe(false);
  });
});

describe("eod nudge", () => {
  it("fires within 30 minutes after the scheduled end while on shift", () => {
    const at = new Date("2026-08-31T16:20:00Z").getTime();
    expect(eodNudge(base, at, new Set())?.kind).toBe("eod");
  });
  it("does not fire mid-shift", () => {
    expect(eodNudge(base, NOW, new Set())).toBeNull();
  });
  it("fires from the server EOD prompt before the scheduled end", () => {
    const facts = { ...base, promptKind: "eod" as const, nextPromptAt: "2026-08-31T15:50:00Z" };
    const at = new Date("2026-08-31T15:50:00Z").getTime();
    expect(eodNudge(facts, at, new Set())?.title).toBe("EOD review is due");
  });
  it("still fires inside the grace after clock-out, and stops once the grace ends", () => {
    const clockedOut = { ...base, sessionState: "clocked_out", clockedOutAt: "2026-08-31T16:05:00Z" };
    const withinGrace = new Date("2026-08-31T16:40:00Z").getTime();
    expect(eodNudge(clockedOut, withinGrace, new Set())?.kind).toBe("eod");
    const pastGrace = new Date("2026-08-31T17:05:00Z").getTime();
    expect(eodNudge(clockedOut, pastGrace, new Set())).toBeNull();
  });
});

describe("eodAlertDue", () => {
  it("opens ten minutes before the scheduled end", () => {
    const facts = { ...base };
    expect(eodAlertDue(facts, new Date("2026-08-31T15:49:59Z").getTime())).toBe(false);
    expect(eodAlertDue(facts, new Date("2026-08-31T15:50:00Z").getTime())).toBe(true);
  });
  it("stays live through clock-out and closes one hour after the scheduled end", () => {
    const facts = { ...base, sessionState: "clocked_out", clockedOutAt: "2026-08-31T16:05:00Z" };
    expect(eodAlertDue(facts, new Date("2026-08-31T16:20:00Z").getTime())).toBe(true);
    expect(eodAlertDue(facts, new Date("2026-08-31T16:59:59Z").getTime())).toBe(true);
    expect(eodAlertDue(facts, new Date("2026-08-31T17:00:01Z").getTime())).toBe(false);
  });
  it("lets a server EOD signal open the alert early, but never past the grace", () => {
    const facts = { ...base, promptKind: "eod" as const, sessionState: "eod_due" };
    expect(eodAlertDue(facts, new Date("2026-08-31T15:00:00Z").getTime())).toBe(true);
    expect(eodAlertDue(facts, new Date("2026-08-31T17:00:01Z").getTime())).toBe(false);
  });
  it("clears on submission and follows the server signal without a scheduled end", () => {
    expect(eodAlertDue({ ...base, eodSubmitted: true }, new Date("2026-08-31T16:10:00Z").getTime())).toBe(false);
    const unscheduled = { ...base, shiftEndsAt: null, sessionState: "eod_due" };
    expect(eodAlertDue(unscheduled, new Date("2026-08-31T23:00:00Z").getTime())).toBe(true);
  });
});

describe("scheduledShiftEnd", () => {
  it("prefers the session stamp, then the day window, then the upcoming window", () => {
    expect(scheduledShiftEnd({ sessionEnd: "2026-08-31T16:00:00Z", dayShiftEnd: "2026-08-31T16:00:00Z", upcomingEnd: "2026-09-01T16:00:00Z" })).toBe("2026-08-31T16:00:00Z");
    // After clock-out the session is gone and the upcoming window has rolled to
    // tomorrow; the day window is what keeps the EOD alert alive.
    expect(scheduledShiftEnd({ dayShiftEnd: "2026-08-31T16:00:00Z", upcomingEnd: "2026-09-01T16:00:00Z" })).toBe("2026-08-31T16:00:00Z");
    expect(scheduledShiftEnd({ upcomingEnd: "2026-09-01T16:00:00Z" })).toBe("2026-09-01T16:00:00Z");
    expect(scheduledShiftEnd({})).toBeNull();
  });
});

describe("avatar prompt", () => {
  it("asks for an EOD submission with shift and task context", () => {
    const prompt = avatarPrompt({ ...base, promptKind: "eod", timezone: "UTC", completedTasks: 3, openTasks: 1 }, NOW);
    expect(prompt.action).toBe("open_eod");
    expect(prompt.body).toContain("4:00 PM");
    expect(prompt.body).toContain("3 completed and 1 open task");
    expect(prompt.body).toContain("submit your EOD");
  });
  it("keeps asking after clock-out inside the grace, then returns to off shift", () => {
    const clockedOut = { ...base, sessionState: "clocked_out", clockedOutAt: "2026-08-31T16:05:00Z", timezone: "UTC" };
    const withinGrace = avatarPrompt(clockedOut, new Date("2026-08-31T16:30:00Z").getTime());
    expect(withinGrace.action).toBe("open_eod");
    expect(withinGrace.body).toContain("ended at 4:00 PM");
    const pastGrace = avatarPrompt(clockedOut, new Date("2026-08-31T17:05:00Z").getTime());
    expect(pastGrace.heading).toBe("Off shift");
  });
  it("stops EOD reminders after the report is submitted", () => {
    const facts = { ...base, promptKind: "eod" as const, eodSubmitted: true };
    expect(avatarPrompt(facts, NOW).heading).toBe("Off shift");
    expect(eodNudge(facts, NOW, new Set())).toBeNull();
  });
  it("asks for today's work immediately after clock-in", () => {
    const prompt = avatarPrompt({ ...base, promptKind: "plan" }, NOW);
    expect(prompt.heading).toBe("What are you working on today?");
    expect(prompt.body).toContain("This does not affect attendance.");
    // The compact bubble line is a call to action, never a repeat of the question.
    expect(prompt.compact).toBe("Set today's focus.");
  });
  it("keeps paused and off-shift states explicit instead of asking for work", () => {
    expect(avatarPrompt({ ...base, sessionState: "paused" }, NOW).heading).toBe("Shift paused");
    expect(avatarPrompt({ ...base, clockedOutAt: "2026-08-31T09:30:00Z", sessionState: "clocked_out" }, NOW).heading).toBe("Off shift");
  });
});

describe("recorded update receipt", () => {
  it("clears the due prompt locally after a confirmed response", () => {
    const facts = clearRecordedUpdatePrompt({ ...base, promptRequired: true, promptKind: "hourly_fallback", nextPromptAt: "2026-08-31T10:00:00Z" });
    expect(facts.promptRequired).toBe(false);
    expect(facts.promptKind).toBeNull();
    expect(avatarPrompt(facts, NOW).kind).toBe("available");
  });
});

describe("snooze escalation", () => {
  it("snoozes 10 then 20 minutes, then marks missed", () => {
    expect(nextSnoozeDelayMs(0)).toBe(600_000);
    expect(nextSnoozeDelayMs(1)).toBe(1_200_000);
    expect(nextSnoozeDelayMs(2)).toBeNull();
    expect(snoozeUntil(NOW, 0)).toBe(NOW + 600_000);
    expect(snoozeUntil(NOW, 2)).toBeNull();
  });
});

describe("shift elapsed fraction", () => {
  it("splits the shift into a 0..1 fraction with a readable label", () => {
    const mid = new Date("2026-08-31T12:05:00Z").getTime();
    const { fraction, label } = shiftElapsedFraction(base, mid);
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.6);
    expect(label).toBe("4h 00m");
    expect(shiftElapsedFraction(base, mid).remaining).toBe("3h 55m left");
  });
  it("anchors the ring to the scheduled day instead of a late clock-in", () => {
    const lateClockIn = { ...base, clockedInAt: "2026-08-31T10:00:00Z" };
    expect(shiftElapsedFraction(lateClockIn, NOW).fraction).toBeCloseTo(0.25);
  });
  it("keeps scheduled progress truthful while the employee is paused", () => {
    const paused = { ...base, sessionState: "paused", pausedSeconds: 45 * 60, pausedAt: "2026-08-31T09:30:00Z" };
    expect(shiftElapsedFraction(paused, NOW).fraction).toBeCloseTo(0.25);
    expect(shiftElapsedFraction(paused, NOW).remaining).toBe("6h 00m left");
    expect(shiftElapsedFraction(paused, NOW).label).toBe("40m");
    expect(shiftElapsedFraction(paused, NOW + 60 * 60_000).label).toBe("40m");
  });
  it("does not invent zero minutes when the schedule end is unavailable", () => {
    const noEnd = { ...base, shiftEndsAt: null };
    expect(shiftElapsedFraction(noEnd, NOW)).toMatchObject({ fraction: 0, remaining: "Time unavailable", progressAvailable: false });
  });
  it("uses clock-in only for elapsed time when the scheduled start is unavailable", () => {
    const noScheduleStart = { ...base, shiftStartsAt: null };
    expect(shiftElapsedFraction(noScheduleStart, NOW)).toMatchObject({
      fraction: 0,
      label: "1h 55m",
      remaining: "Time unavailable",
      progressAvailable: false,
    });
  });
  it("clamps to 1 after the scheduled end and names the completed shift", () => {
    const late = new Date("2026-08-31T20:00:00Z").getTime();
    const result = shiftElapsedFraction(base, late);
    expect(result.fraction).toBe(1);
    expect(result.remaining).toBe("Shift complete");
  });
  it("never renders negative elapsed time before a stale future shift boundary", () => {
    const future = { ...base, shiftStartsAt: "2026-09-03T15:00:00Z", clockedInAt: "2026-09-03T15:00:00Z" };
    expect(shiftElapsedFraction(future, NOW).label).toBe("0m");
  });
});

describe("collectNudges", () => {
  it("returns every due nudge in one pass", () => {
    const facts: CompanionDayFacts = { ...base, promptRequired: true, nextPromptAt: "2026-08-31T10:00:00Z" };
    const at = new Date("2026-08-31T16:10:00Z").getTime();
    const lateFacts: CompanionDayFacts = { ...facts, clockedInAt: "2026-08-31T08:05:00Z", clockedOutAt: null };
    const nudges = collectNudges(lateFacts, at, new Set());
    expect(nudges.map((nudge) => nudge.kind).sort()).toEqual(["eod", "hourly"]);
  });
});

describe("mergeAvatarChatEntries", () => {
  const op = { op: "complete_task", statement: "Done.", taskId: "t-1", enabled: true } as const;
  const result = { op, status: "recorded", message: "Recorded." } as const;

  it("preserves local tool state when the incoming turn is text-only", () => {
    const merged = mergeAvatarChatEntries(
      [{ id: "a-1", role: "assistant", text: "Review.", operations: [{ ...op }], toolResults: [{ ...result }] }],
      [{ id: "a-1", role: "assistant", text: "Review.", createdAt: "2026-08-31T10:00:00Z" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.operations).toHaveLength(1);
    expect(merged[0]?.toolResults).toHaveLength(1);
  });

  it("prefers incoming text while keeping local tool state, and drops cleared entries", () => {
    const merged = mergeAvatarChatEntries(
      [
        { id: "a-1", role: "assistant", text: "Old.", operations: [{ ...op }] },
        { id: "u-9", role: "user", text: "Cleared away." },
      ],
      [{ id: "a-1", role: "assistant", text: "New.", createdAt: "2026-08-31T10:01:00Z", toolResults: [{ ...result }] }],
    );
    expect(merged.map((entry) => entry.id)).toEqual(["a-1"]);
    expect(merged[0]?.text).toBe("New.");
    expect(merged[0]?.operations).toHaveLength(1);
    expect(merged[0]?.toolResults).toHaveLength(1);
  });

  it("serializes tool state for the vault while keeping system notices ephemeral", () => {
    expect(serializeAvatarChatEntry({ id: "a-1", role: "assistant", text: "Hi.", operations: [{ ...op }] }))
      .toMatchObject({ id: "a-1", operations: [{ op: "complete_task" }] });
    expect(serializeAvatarChatEntry({ id: "s-1", role: "system", text: "Nope." })).toBeNull();
  });

  it("persists a ready recap next-steps moment but never a drafting one", () => {
    const moment = {
      intervalId: "i-1", label: "2:17–3:17 PM", status: "ready" as const,
      items: [{ proposalId: "p-1", operation: "complete_task" as const, status: "pending", title: "Wire GitHub context", rationale: "Tests pass.", taskId: "t-1", editable: false }],
      states: {}, failures: {},
    };
    const ready = serializeAvatarChatEntry({ id: "next-steps-i-1", role: "assistant", text: "Lead.", nextSteps: moment });
    expect(ready?.nextSteps).toEqual(moment);
    const drafting = serializeAvatarChatEntry({ id: "next-steps-i-1", role: "assistant", text: "Lead.", nextSteps: { ...moment, status: "drafting" } });
    expect(drafting?.nextSteps).toBeUndefined();
  });

  it("keeps the local next-steps card when another window saved a text-only turn", () => {
    const moment = {
      intervalId: "i-1", label: "2:17–3:17 PM", status: "ready" as const,
      items: [{ proposalId: "p-1", operation: "add_subtask" as const, status: "pending", title: "Verify staging", rationale: "Untested.", taskId: "t-2", editable: true }],
      states: {}, failures: {},
    };
    const merged = mergeAvatarChatEntries(
      [{ id: "next-steps-i-1", role: "assistant", text: "Lead.", nextSteps: moment }],
      [{ id: "next-steps-i-1", role: "assistant", text: "Lead.", createdAt: "2026-10-05T15:49:00Z" }],
    );
    expect(merged[0]?.nextSteps).toEqual(moment);
    // And an incoming turn that does carry a moment wins over the local one.
    const newer = { ...moment, status: "done" as const, states: { "p-1": "skipped" as const } };
    const mergedNewer = mergeAvatarChatEntries(
      [{ id: "next-steps-i-1", role: "assistant", text: "Lead.", nextSteps: moment }],
      [{ id: "next-steps-i-1", role: "assistant", text: "Lead.", createdAt: "2026-10-05T15:50:00Z", nextSteps: newer }],
    );
    expect(mergedNewer[0]?.nextSteps).toEqual(newer);
  });
});

describe("agenda auto-expand", () => {
  const key = agendaAutoExpandKey("2026-08-31", "draft");

  it("expands once when the agenda first becomes due", () => {
    const first = nextAgendaAutoExpand(null, true, key);
    expect(first).toEqual({ expand: true, key });
  });

  it("does not re-expand after the employee collapses the companion", () => {
    const first = nextAgendaAutoExpand(null, true, key);
    // A later render sees the same key (already expanded), even though the
    // composer is now collapsed — it must leave the collapse alone.
    expect(nextAgendaAutoExpand(first.key, true, key)).toEqual({ expand: false, key });
  });

  it("re-expands only when the shift or plan state changes", () => {
    const first = nextAgendaAutoExpand(null, true, key);
    const nextKey = agendaAutoExpandKey("2026-09-01", "draft");
    expect(nextAgendaAutoExpand(first.key, true, nextKey)).toEqual({ expand: true, key: nextKey });
  });

  it("clears the key once the agenda is no longer due", () => {
    expect(nextAgendaAutoExpand("2026-08-31:draft", false, key)).toEqual({ expand: false, key: null });
  });
});

describe("mergeConversationTurns", () => {
  const turn = (id: string, createdAt: string, text = id) => ({ id, createdAt, text });

  it("keeps a review turn another window wrote instead of overwriting it", () => {
    const stored = [turn("u-1", "2026-09-15T10:00:00Z"), turn("review-1", "2026-09-15T10:01:00Z", "Review")];
    const incoming = [turn("u-1", "2026-09-15T10:00:00Z"), turn("shared-note", "2026-09-15T10:02:00Z")];
    const merged = mergeConversationTurns(stored, incoming);
    expect(merged.map((entry) => entry.id)).toEqual(["u-1", "review-1", "shared-note"]);
  });

  it("lets the writer's version win for the same turn id", () => {
    const merged = mergeConversationTurns(
      [turn("review-1", "2026-09-15T10:00:00Z", "Old text")],
      [turn("review-1", "2026-09-15T10:00:00Z", "New text")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("New text");
  });

  it("never wipes the shared store when a window saves an empty history (clears use the explicit clear path)", () => {
    expect(mergeConversationTurns([turn("u-1", "2026-09-15T10:00:00Z")], [])).toEqual([turn("u-1", "2026-09-15T10:00:00Z")]);
  });

  it("caps the merged history at the newest 60 turns in order", () => {
    const stored = Array.from({ length: 60 }, (_, index) => turn(`t-${index}`, `2026-09-15T10:${String(index).padStart(2, "0")}:00Z`));
    const incoming = [turn("t-new", "2026-09-15T11:00:00Z")];
    const merged = mergeConversationTurns(stored, incoming);
    expect(merged).toHaveLength(60);
    expect(merged[merged.length - 1]?.id).toBe("t-new");
    expect(merged.some((entry) => entry.id === "t-0")).toBe(false);
  });
});

describe("composerSendTarget", () => {
  it("lets a recap edit win over the pending agenda prompt", () => {
    expect(composerSendTarget({ agendaDue: true, recapEditing: true })).toBe("recap");
    expect(composerSendTarget({ agendaDue: false, recapEditing: true })).toBe("recap");
  });

  it("keeps the agenda prompt on the composer when no recap edit is active", () => {
    expect(composerSendTarget({ agendaDue: true, recapEditing: false })).toBe("agenda");
    expect(composerSendTarget({ agendaDue: false, recapEditing: false })).toBe("update");
  });
});

describe("bubbleAction", () => {
  it("offers the EOD review shortcut only for the EOD prompt", () => {
    expect(bubbleAction("eod")).toEqual({ kind: "open_eod", label: "Open EOD review" });
    expect(bubbleAction("check_in")).toBeNull();
    expect(bubbleAction("paused")).toBeNull();
    expect(bubbleAction("off_shift")).toBeNull();
    expect(bubbleAction("available")).toBeNull();
  });

  it("offers the SOD planning shortcut only for the agenda prompt", () => {
    expect(bubbleAction("agenda")).toEqual({ kind: "open_plan", label: "Set today's goal" });
  });
});

describe("nextStepState", () => {
  it("maps proposal outcomes without leaving a settled decision in flight", () => {
    expect(nextStepState("accept", "applied")).toBe("applied");
    expect(nextStepState("accept", "applying")).toBe("processing");
    expect(nextStepState("accept", "failed")).toBe("failed");
    expect(nextStepState("accept", "stale")).toBe("failed");
    expect(nextStepState("skip", "rejected")).toBe("skipped");
    expect(nextStepState("skip", undefined)).toBe("skipped");
    expect(nextStepState("accept", undefined)).toBe("failed");
  });
});

describe("mergeNextStepsMoment", () => {
  const item = { proposalId: "p-1", operation: "create_task" as const, status: "pending", title: "Document CI", rationale: "Evidence.", taskId: null, editable: true };
  const moment = (overrides: Partial<RecapNextStepsMoment>): RecapNextStepsMoment => ({
    intervalId: "i-1", label: "8:02–8:12 PM", status: "ready", items: [item], states: {}, failures: {}, ...overrides,
  });

  it("never lets a stale snapshot regress a landed decision", () => {
    const applied = moment({ states: { "p-1": "applied" } });
    const staleProcessing = moment({ states: { "p-1": "processing" } });
    expect(mergeNextStepsMoment(applied, staleProcessing).states["p-1"]).toBe("applied");
    expect(mergeNextStepsMoment(staleProcessing, applied).states["p-1"]).toBe("applied");
  });

  it("keeps a done moment done and the richer snapshot's items", () => {
    const done = moment({ status: "done", states: { "p-1": "skipped" } });
    const ready = moment({ status: "ready" });
    expect(mergeNextStepsMoment(done, ready).status).toBe("done");
    const drafting = moment({ status: "drafting", items: [] });
    expect(mergeNextStepsMoment(drafting, ready).items).toHaveLength(1);
    expect(mergeNextStepsMoment(ready, drafting).items).toHaveLength(1);
  });

  it("carries a failure reason across the merge", () => {
    const failed = moment({ states: { "p-1": "failed" }, failures: { "p-1": "The task changed." } });
    const stale = moment({ states: { "p-1": "processing" } });
    expect(mergeNextStepsMoment(failed, stale).failures["p-1"]).toBe("The task changed.");
    expect(mergeNextStepsMoment(stale, failed).failures["p-1"]).toBe("The task changed.");
  });
});

describe("avatarBubble", () => {
  it("shows processing while the recap is being analyzed, even with a due prompt", () => {
    expect(avatarBubble({ preparing: true, eodDue: false, recapReady: false, promptDue: true })).toBe("processing");
    expect(avatarBubble({ preparing: true, eodDue: false, recapReady: true, promptDue: true })).toBe("processing");
  });

  it("shows the ready recap ahead of the prompt it came from", () => {
    expect(avatarBubble({ preparing: false, eodDue: false, recapReady: true, promptDue: true })).toBe("recap");
    expect(avatarBubble({ preparing: false, eodDue: false, recapReady: true, promptDue: false })).toBe("recap");
  });

  it("shows the EOD alert ahead of a ready recap and in-flight analysis", () => {
    expect(avatarBubble({ preparing: false, eodDue: true, recapReady: true, promptDue: true })).toBe("prompt");
    expect(avatarBubble({ preparing: true, eodDue: true, recapReady: true, promptDue: true })).toBe("prompt");
    expect(avatarBubble({ preparing: false, eodDue: true, recapReady: false, promptDue: true })).toBe("prompt");
  });

  it("falls back to the prompt, then to nothing", () => {
    expect(avatarBubble({ preparing: false, eodDue: false, recapReady: false, promptDue: true })).toBe("prompt");
    expect(avatarBubble({ preparing: false, eodDue: false, recapReady: false, promptDue: false })).toBe(null);
  });
});

describe("prompt reminder turns", () => {
  it("recognizes marked and legacy reminder scaffolding, never real dialogue", () => {
    expect(isPromptReminderTurn({ role: "assistant", kind: "prompt", text: "Anything" })).toBe(true);
    expect(isPromptReminderTurn({ role: "assistant", text: "What are you working on today?: Set today's focus. This does not affect attendance." })).toBe(true);
    expect(isPromptReminderTurn({ role: "assistant", text: "First check-in due: Record what you started or moved forward." })).toBe(true);
    expect(isPromptReminderTurn({ role: "assistant", text: "EOD review is due: Review the record and submit your EOD when it is accurate." })).toBe(true);
    expect(isPromptReminderTurn({ role: "user", text: "What are you working on today?: my plan" })).toBe(false);
    expect(isPromptReminderTurn({ role: "assistant", text: "Recorded your update." })).toBe(false);
  });

  it("strips reminders from interpretation payloads", () => {
    const entries = [
      { role: "assistant", text: "What are you working on today?: Set today's focus." },
      { role: "user", text: "Finalizing the dashboard." },
      { role: "assistant", text: "Noted." },
    ];
    expect(stripPromptReminderTurns(entries)).toEqual([entries[1], entries[2]]);
  });

  it("keeps recap turns until they are decided while pruning stale reminders", () => {
    const reminder = { id: "prompt:today:check_in", role: "assistant", kind: "prompt", text: "First check-in due: Record what you started." };
    const staleReminder = { id: "prompt:today:check_in:old", role: "assistant", kind: "prompt", text: "Check-in due: Record what changed." };
    const recapTurn = { id: "recap:interval-1", role: "assistant", kind: "prompt", text: "Reviewed the recap bubble.", activityInterval: { id: "interval-1" } };
    const decidedRecap = { id: "recap:interval-0", role: "assistant", kind: "prompt", text: "Earlier recap." };
    const dialogue = { id: "u-1", role: "user", text: "Finalizing the dashboard." };
    expect(prunePromptReminderTurns([reminder, staleReminder, recapTurn, decidedRecap, dialogue], reminder.id))
      .toEqual([reminder, recapTurn, dialogue]);
  });

  it("keeps only the latest undecided recap turn in the chat", () => {
    const olderRecap = { id: "recap:interval-1", activityInterval: { reviewStatus: "inferred" } };
    const newestRecap = { id: "recap:interval-2", activityInterval: { reviewStatus: "inferred" } };
    const decidedRecap = { id: "recap:interval-0", activityInterval: { reviewStatus: "confirmed" } };
    const receipt = { id: "recap:interval-3" };
    expect(replaceUndecidedRecapTurns([olderRecap, decidedRecap, receipt], newestRecap.id))
      .toEqual([decidedRecap, receipt]);
  });

  it("never serializes reminder scaffolding into the vault", () => {
    expect(serializeAvatarChatEntry({ id: "p1", role: "assistant", text: "First check-in due: Record what you started.", kind: "prompt" })).toBeNull();
    expect(serializeAvatarChatEntry({ id: "p2", role: "assistant", text: "Check-in due: Record what changed since your last update." })).toBeNull();
    expect(serializeAvatarChatEntry({ id: "u1", role: "user", text: "Shipped the fix." })).not.toBeNull();
  });
});

describe("check-in banner timing", () => {
  it("waits for the scheduled follow-up instead of demanding a check-in as soon as the plan is set", () => {
    const scheduled = { ...base, promptRequired: true, promptKind: "follow_up" as const, nextPromptAt: new Date(NOW + 30 * 60_000).toISOString() };
    const waiting = avatarPrompt(scheduled, NOW);
    expect(waiting.kind).toBe("available");
    expect(waiting.body).toContain("next check-in");
    expect(waiting.compact).toContain("Next check-in");
    expect(avatarPrompt(scheduled, NOW + 31 * 60_000).kind).toBe("check_in");
  });
});

describe("header window drag", () => {
  const target = (closestResult: unknown) => ({ closest: () => closestResult }) as unknown as EventTarget;
  it("starts on the header chrome and never on its controls", () => {
    // The shift status and empty header chrome drag the window…
    expect(isHeaderDragStart(0, target(null))).toBe(true);
    // …while buttons, tabs, and fields keep their own clicks.
    expect(isHeaderDragStart(0, target({}))).toBe(false);
    // Only the primary button drags, and a missing target never does.
    expect(isHeaderDragStart(2, target(null))).toBe(false);
    expect(isHeaderDragStart(0, null)).toBe(false);
  });
});

describe("recap next-steps moment settles back to the orb", () => {
  it("uses one settle beat after the moment is fully decided", () => {
    expect(nextStepsSettleMs()).toBe(NEXT_STEPS_SETTLE_MS);
    expect(NEXT_STEPS_SETTLE_MS).toBeGreaterThanOrEqual(3_000);
  });
});
