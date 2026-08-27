import { describe, expect, it } from "vitest";
import {
  EMPTY_COMPANION_RECORD,
  MAX_PROMPTS_PER_HOUR,
  evaluateCompanion,
  markAnswered,
  markFired,
  markIgnored,
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

  it("stays idle off shift", () => {
    const decision = evaluateCompanion(base({ gate: gate({ active: false, canClockIn: true, message: "off shift" }) }));
    expect(decision.state).toBe("idle");
  });

  it("shows quiet mode and ignores every other cause", () => {
    const record = setQuietMode(EMPTY_COMPANION_RECORD, true);
    const decision = evaluateCompanion(base({ record }));
    expect(decision.state).toBe("quiet");
    expect(decision.suppressReason).toBe("quiet-mode");
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

  it("enforces the rolling-hour frequency cap, EOD exempt", () => {
    let record: CompanionRecord = EMPTY_COMPANION_RECORD;
    for (let index = 0; index < MAX_PROMPTS_PER_HOUR; index += 1) {
      record = markFired(record, `progress:s:${index}`, NOW);
    }
    const decision = evaluateCompanion(base({ record }));
    expect(decision.prompt).toBeNull();
    expect(decision.suppressReason).toBe("frequency-cap");
  });

  it("escalates the quiet window with each ignored prompt", () => {
    const d = day();
    const cause = `progress:session-1:${d.prompt.nextPromptAt}`;
    let record = markFired(EMPTY_COMPANION_RECORD, cause, NOW);
    record = markIgnored(record, cause, NOW);
    const fiveMinLater = new Date(NOW.getTime() + 5 * 60_000);
    expect(evaluateCompanion(base({ day: d, record, now: fiveMinLater })).prompt).toBeNull();
    const elevenMinLater = evaluateCompanion(base({ day: d, record, now: new Date(NOW.getTime() + 11 * 60_000) }));
    expect(elevenMinLater.prompt).not.toBeNull();
  });

  it("applies escalating backoff windows", () => {
    let record = markIgnored(EMPTY_COMPANION_RECORD, "c", NOW);
    record = markIgnored(record, "c", NOW);
    expect((record.ignored.c ?? 0)).toBe(2);
  });

  it("re-surfaces an ignored prompt after its backoff window, re-armed by an answer", () => {
    const d = day();
    const cause = `progress:session-1:${d.prompt.nextPromptAt}`;
    const record = markFired(EMPTY_COMPANION_RECORD, cause, NOW);
    const justFired = evaluateCompanion(base({ day: d, record }));
    expect(justFired.prompt).toBeNull();
    expect(justFired.suppressReason).toBe("backoff");
    const afterWindow = evaluateCompanion(base({ day: d, record, now: new Date(NOW.getTime() + 6 * 60_000) }));
    expect(afterWindow.prompt).not.toBeNull();
    const answered = markAnswered(record, cause, NOW);
    expect(evaluateCompanion(base({ day: d, record: answered, lastResponseAt: NOW.toISOString(), now: new Date(NOW.getTime() + 60_000) })).prompt).not.toBeNull();
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
