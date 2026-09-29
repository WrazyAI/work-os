import { describe, expect, it } from "vitest";
import {
  clockInNudge, collectNudges, composerSendTarget, eodNudge, hasOpenShiftSession, hourlyNudge, isOnShift, isPromptReminderTurn, mergeAvatarChatEntries, mergeConversationTurns, prunePromptReminderTurns, serializeAvatarChatEntry, stripPromptReminderTurns,
  avatarBubble, avatarPrompt, clearRecordedUpdatePrompt, nextSnoozeDelayMs, shiftElapsedFraction, snoozeUntil,
  agendaAutoExpandKey, nextAgendaAutoExpand,
  type CompanionDayFacts,
} from "./avatarLogic";

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
});

describe("avatar prompt", () => {
  it("asks for an EOD submission with shift and task context", () => {
    const prompt = avatarPrompt({ ...base, promptKind: "eod", timezone: "UTC", completedTasks: 3, openTasks: 1 }, NOW);
    expect(prompt.action).toBe("open_eod");
    expect(prompt.body).toContain("4:00 PM");
    expect(prompt.body).toContain("3 completed and 1 open task");
    expect(prompt.body).toContain("submit your EOD");
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

describe("avatarBubble", () => {
  it("shows processing while the recap is being analyzed, even with a due prompt", () => {
    expect(avatarBubble({ preparing: true, recapReady: false, promptDue: true })).toBe("processing");
    expect(avatarBubble({ preparing: true, recapReady: true, promptDue: true })).toBe("processing");
  });

  it("shows the ready recap ahead of the prompt it came from", () => {
    expect(avatarBubble({ preparing: false, recapReady: true, promptDue: true })).toBe("recap");
    expect(avatarBubble({ preparing: false, recapReady: true, promptDue: false })).toBe("recap");
  });

  it("falls back to the prompt, then to nothing", () => {
    expect(avatarBubble({ preparing: false, recapReady: false, promptDue: true })).toBe("prompt");
    expect(avatarBubble({ preparing: false, recapReady: false, promptDue: false })).toBe(null);
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
