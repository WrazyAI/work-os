import { describe, expect, it } from "vitest";
import {
  EMPTY_COMPANION_RECORD,
  MAX_PROMPTS_PER_HOUR,
  evaluateCompanion,
  markAnswered,
  markFired,
  markIgnored,
  clearSessionReminders,
  setQuietMode,
  snooze,
  type CompanionRecord,
} from "./companionMachine";
import type { DayData } from "./types";

const NOW = new Date("2026-08-27T10:00:00Z");
const SHIFT_END = "2026-08-27T18:00:00Z";

function gate(overrides: Partial<Parameters<typeof evaluateCompanion>[0]["gate"]> = {}) {
  return {
    active: true, canClockIn: false, message: "", worktivitySynced: false,
    ...overrides,
  } as Parameters<typeof evaluateCompanion>[0]["gate"];
}

function day(overrides: Partial<DayData> = {}): DayData {
  return {
    at: NOW.toISOString(), shiftDate: "2026-08-27",
    shift: { startsAt: "2026-08-27T09:00:00Z", endsAt: SHIFT_END, timezone: "UTC", breaks: [] },
    prompt: { kind: "optional", nextPromptAt: new Date(NOW.getTime() - 60_000).toISOString(), required: false, reason: "Optional check-in." },
    tasks: [{ id: "t1", title: "Task one", completed: false }],
    niftySync: { fresh: true }, evidence: [], proposals: [], report: null,
    session: { id: "session-1", state: "clocked_in", clocked_in_at: "2026-08-27T09:30:00Z", clocked_out_at: null, paused_seconds: 0 },
    plan: { id: "p1", shift_date: "2026-08-27", revision: 1, status: "confirmed", freeform_intent: "ship the release.", suggestion_task_ids: [], items: [] },
    ...overrides,
  } as DayData;
}

function base(overrides: Partial<Parameters<typeof evaluateCompanion>[0]> = {}) {
  return {
    now: NOW, online: true, gate: gate(), day: day(), record: EMPTY_COMPANION_RECORD,
    lastResponseAt: null, ...overrides,
  };
}

describe("companion state ladder", () => {
  it("goes silent when offline", () => {
    const decision = evaluateCompanion(base({ online: false }));
    expect(decision.state).toBe("offline");
    expect(decision.prompt).toBeNull();
  });

  it("never prompts after clock-out, even with a due prompt", () => {
    const d = day({ session: { id: "s", state: "clocked_out", scheduled_starts_at: "2026-08-27T09:00:00Z", scheduled_ends_at: SHIFT_END, clocked_in_at: "2026-08-27T09:00:00Z", clocked_out_at: NOW.toISOString(), paused_seconds: 0 } });
    const decision = evaluateCompanion(base({ day: d, gate: gate({ active: false }) }));
    expect(decision.state).toBe("idle");
    expect(decision.prompt).toBeNull();
  });

  it("tolerates a degraded day response without a prompt object", () => {
    const degraded = { ...day(), prompt: undefined } as unknown as DayData;
    expect(() => evaluateCompanion(base({ day: degraded }))).not.toThrow();
  });

  it("stays idle off shift", () => {
    const decision = evaluateCompanion(base({ gate: gate({ active: false, canClockIn: true, message: "off shift" }) }));
    expect(decision.state).toBe("idle");
  });

  it("shows quiet mode for ordinary prompts", () => {
    const record = setQuietMode(EMPTY_COMPANION_RECORD, true);
    const decision = evaluateCompanion(base({ record }));
    expect(decision.state).toBe("quiet");
    expect(decision.suppressReason).toBe("quiet-mode");
  });

  it("does not let quiet mode or snooze suppress the required EOD prompt", () => {
    const eod = day({ prompt: { kind: "eod", nextPromptAt: NOW.toISOString(), required: true, reason: "EOD due" } });
    const quiet = setQuietMode(EMPTY_COMPANION_RECORD, true);
    const snoozed = snooze(EMPTY_COMPANION_RECORD, "progress:session-1:due", new Date(NOW.getTime() + 30 * 60_000));

    expect(evaluateCompanion(base({ day: eod, record: quiet })).state).toBe("eod_due");
    expect(evaluateCompanion(base({ day: eod, record: snoozed })).state).toBe("eod_due");
  });

  it("suppresses while snoozed and wakes after expiry", () => {
    const snoozed = snooze(EMPTY_COMPANION_RECORD, "progress:s:1", new Date(NOW.getTime() + 30 * 60_000));
    expect(evaluateCompanion(base({ record: snoozed })).state).toBe("quiet");
    const expired = snooze(EMPTY_COMPANION_RECORD, "progress:s:1", new Date(NOW.getTime() - 60_000));
    const decision = evaluateCompanion(base({ record: expired }));
    expect(decision.state).toBe("progress_check");
    expect(decision.prompt).not.toBeNull();
  });
});

describe("prompts", () => {
  it("fires the EOD prompt inside the final 10 minutes and names the minutes", () => {
    const eod = day({ prompt: { kind: "optional", nextPromptAt: null as unknown as string, required: false, reason: "" } });
    const at = new Date("2026-08-27T17:53:00Z");
    const decision = evaluateCompanion(base({ now: at, day: eod }));
    expect(decision.state).toBe("eod_due");
    expect(decision.prompt?.body).toContain("7 minutes");
    expect(decision.prompt?.action).toBe("open_eod");
  });

  it("fires the EOD prompt when the server marks it, and deduplicates", () => {
    const d = day({ prompt: { kind: "eod", nextPromptAt: NOW.toISOString(), required: true, reason: "EOD due" } });
    const first = evaluateCompanion(base({ day: d }));
    expect(first.state).toBe("eod_due");
    expect(first.prompt).not.toBeNull();
    const record = markFired(EMPTY_COMPANION_RECORD, first.prompt!.id, NOW);
    const second = evaluateCompanion(base({ day: d, record }));
    expect(second.prompt).toBeNull();
    expect(second.suppressReason).toBe("already-reminded");
  });

  it("keeps an acknowledged EOD prompt deduplicated through the end of the session", () => {
    const d = day({ prompt: { kind: "eod", nextPromptAt: NOW.toISOString(), required: true, reason: "EOD due" } });
    const first = evaluateCompanion(base({ day: d }));
    const fired = markFired(EMPTY_COMPANION_RECORD, first.prompt!.id, NOW);
    const acknowledged = markAnswered(fired, first.prompt!.id, new Date(NOW.getTime() + 60_000));

    const next = evaluateCompanion(base({ day: d, record: acknowledged, now: new Date(NOW.getTime() + 2 * 60_000) }));
    expect(next.prompt).toBeNull();
    expect(next.suppressReason).toBe("acknowledged");
  });

  it("asks for the plan when the server requires it and none is confirmed", () => {
    const d = day({ prompt: { kind: "plan", nextPromptAt: NOW.toISOString(), required: true, reason: "Shift has started." }, plan: { id: "p", shift_date: "2026-08-27", revision: 1, status: "draft", freeform_intent: null, suggestion_task_ids: [], items: [] } });
    const decision = evaluateCompanion(base({ day: d }));
    expect(decision.state).toBe("awaiting_plan");
    expect(decision.prompt?.action).toBe("open_plan");
  });

  it("follows up on an open blocker after the quiet period", () => {
    const d = day({ plan: { id: "p", shift_date: "2026-08-27", revision: 1, status: "confirmed", freeform_intent: "ship", suggestion_task_ids: [], items: [{ id: "i1", task_id: "t1", source: "due_today", disposition: "selected", rank: 0, title_snapshot: "Task one", blocker: "signing certificate", item_kind: "nifty_task", completion_state: "open" }] } });
    const decision = evaluateCompanion(base({ day: d, lastResponseAt: new Date(NOW.getTime() - 50 * 60_000).toISOString() }));
    expect(decision.state).toBe("blocker_follow_up");
    expect(decision.prompt?.body).toContain("signing certificate");
  });

  it("mentions overdue tasks in the progress check", () => {
    const d = day({ tasks: [{ id: "t1", title: "Old task", completed: false, due_date: "2026-08-26" }] });
    const decision = evaluateCompanion(base({ day: d }));
    expect(decision.state).toBe("progress_check");
    expect(decision.prompt?.body).toContain("1 task is overdue");
    expect(decision.prompt?.severity).toBe("attention");
  });

  it("greets once within the clock-in window", () => {
    const d = day({ session: { id: "s", state: "clocked_in", scheduled_starts_at: "2026-08-27T09:00:00Z", scheduled_ends_at: SHIFT_END, clocked_in_at: new Date(NOW.getTime() - 2 * 60_000).toISOString(), clocked_out_at: null, paused_seconds: 0 }, prompt: { kind: null, nextPromptAt: null, required: false, reason: "" } });
    const decision = evaluateCompanion(base({ day: d }));
    expect(decision.state).toBe("clock_in_greeting");
    const record = markFired(EMPTY_COMPANION_RECORD, decision.prompt!.id, NOW);
    expect(evaluateCompanion(base({ day: d, record })).state).toBe("idle");
  });
});

describe("quality controls", () => {
  it("suppresses ordinary prompts in the final hour but never the EOD prompt", () => {
    const at = new Date("2026-08-27T17:30:00Z");
    const ordinary = evaluateCompanion(base({
      now: at,
      day: day({ prompt: { kind: "optional", nextPromptAt: at.toISOString(), required: false, reason: "" } }),
    }));
    expect(ordinary.prompt).toBeNull();
    expect(ordinary.suppressReason).toBe("final-hour");
    const eod = evaluateCompanion(base({ now: new Date("2026-08-27T17:53:00Z") }));
    expect(eod.state).toBe("eod_due");
  });

  it("suppresses blocker follow-ups in the final hour", () => {
    const at = new Date("2026-08-27T17:30:00Z");
    const d = day({ plan: { id: "p", shift_date: "2026-08-27", revision: 1, status: "confirmed", freeform_intent: "ship", suggestion_task_ids: [], items: [{ id: "i1", task_id: "t1", source: "due_today", disposition: "selected", rank: 0, title_snapshot: "Task one", blocker: "signing certificate", item_kind: "nifty_task", completion_state: "open" }] } });
    const decision = evaluateCompanion(base({ day: d, now: at, lastResponseAt: new Date(at.getTime() - 50 * 60_000).toISOString() }));
    expect(decision.prompt).toBeNull();
    expect(decision.suppressReason).toBe("final-hour");
  });

  it("EOD pierces quiet mode and snooze", () => {
    const at = new Date("2026-08-27T17:53:00Z");
    const quietRecord = setQuietMode(EMPTY_COMPANION_RECORD, true);
    const quietDecision = evaluateCompanion(base({ now: at, record: quietRecord }));
    expect(quietDecision.state).toBe("eod_due");
    expect(quietDecision.prompt).not.toBeNull();
    const snoozedRecord = snooze(EMPTY_COMPANION_RECORD, "eod:session-1", new Date(at.getTime() + 60 * 60_000));
    const snoozedDecision = evaluateCompanion(base({ now: at, record: snoozedRecord }));
    expect(snoozedDecision.state).toBe("eod_due");
  });

  it("EOD window boundaries: silent at 11 minutes, active at exactly 10", () => {
    const day11 = day({ prompt: { kind: null, nextPromptAt: null as unknown as string, required: false, reason: "" } });
    const at11 = evaluateCompanion(base({ now: new Date("2026-08-27T17:49:00Z"), day: day11 }));
    expect(at11.state).not.toBe("eod_due");
    const at10 = evaluateCompanion(base({ now: new Date("2026-08-27T17:50:00Z"), day: day11 }));
    expect(at10.state).toBe("eod_due");
    expect(at10.prompt).not.toBeNull();
  });

  it("enforces the rolling-hour frequency cap, EOD exempt", () => {
    let record: CompanionRecord = EMPTY_COMPANION_RECORD;
    for (let index = 0; index < MAX_PROMPTS_PER_HOUR; index += 1) {
      record = markFired(record, `progress:s:${index}`, NOW);
    }
    const decision = evaluateCompanion(base({ record }));
    expect(decision.prompt).toBeNull();
    expect(decision.suppressReason).toBe("frequency-cap");
  });

  it("backs off after ignored prompts and clears on an answer", () => {
    const d = day();
    const cause = `progress:session-1:${d.prompt.nextPromptAt}`;
    let record = markIgnored(EMPTY_COMPANION_RECORD, cause, NOW);
    const backedOff = evaluateCompanion(base({ day: d, record }));
    expect(backedOff.prompt).toBeNull();
    expect(backedOff.suppressReason).toBe("backoff");
    record = markAnswered(record, cause, NOW);
    const afterAnswer = evaluateCompanion(base({ day: d, record, lastResponseAt: NOW.toISOString() }));
    expect(afterAnswer.prompt).not.toBeNull();
  });

  it("applies escalating backoff windows", () => {
    let record = markIgnored(EMPTY_COMPANION_RECORD, "c", NOW);
    record = markIgnored(record, "c", NOW);
    expect((record.ignored.c ?? 0)).toBe(2);
  });

  it("prunes every reminder from a closed session without affecting the next session", () => {
    const record = {
      ...EMPTY_COMPANION_RECORD,
      fired: { "progress:session-1:due": NOW.toISOString(), "progress:session-2:due": NOW.toISOString() },
      answered: { "progress:session-1:due": NOW.toISOString(), "progress:session-2:due": NOW.toISOString() },
      ignored: { "progress:session-1:due": 2, "progress:session-2:due": 1 },
      ignoredAt: { "progress:session-1:due": NOW.toISOString(), "progress:session-2:due": NOW.toISOString() },
    } satisfies CompanionRecord;
    expect(clearSessionReminders(record, "session-1")).toMatchObject({
      fired: { "progress:session-2:due": NOW.toISOString() },
      answered: { "progress:session-2:due": NOW.toISOString() },
      ignored: { "progress:session-2:due": 1 },
    });
  });

});

describe("debugger force", () => {
  it("pins a state with its synthetic prompt", () => {
    const decision = evaluateCompanion(base({ force: "blocker_follow_up" }));
    expect(decision.state).toBe("blocker_follow_up");
    expect(decision.prompt?.title).toContain("blocker");
  });

  it("respects offline over force", () => {
    const decision = evaluateCompanion(base({ online: false, force: "progress_check" }));
    expect(decision.state).toBe("offline");
  });
});
