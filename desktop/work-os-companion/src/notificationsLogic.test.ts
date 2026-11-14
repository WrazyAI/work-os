import { describe, expect, it } from "vitest";
import { latestReadyRecap, memoryCandidateIds, mergeOverdueKeys, mergeSeenIds, notificationsBadgeCount, overdueNotifyKey, overdueSummary, readyRecap, recapSurfaceDecision, reduceRecapQueueBubble, unapprovedRecapsBubbleVisible, unseenMemoryIds, unseenOverdueKeys } from "./notificationsLogic";
import type { ActivityInterval, MemoryFact } from "./types";

function fact(id: string, review_status: MemoryFact["review_status"]): MemoryFact {
  return { id, content: `Fact ${id}`, review_status, fact_key: null, local_date: null, occurred_at: "2026-10-07T09:00:00Z" };
}

function interval(id: string, windowStart: string, generationStatus: ActivityInterval["generationStatus"], reviewStatus: ActivityInterval["reviewStatus"]): ActivityInterval {
  return {
    id,
    windowStart,
    windowEnd: windowStart,
    label: `${id} label`,
    promptKind: "follow_up",
    generationStatus,
    reviewStatus,
    headline: null,
    detail: null,
    employeeFeedback: null,
    failureReason: null,
    generatedAt: null,
    reviewedAt: null,
    evidenceExpired: false,
    evidenceCount: 0,
    evidence: [],
  };
}

describe("recap launch selection", () => {
  it("selects the newest ready recap even when it is already approved", () => {
    const confirmed = interval("confirmed-newest", "2026-11-12T15:00:00.000Z", "ready", "confirmed");
    const olderPending = interval("older-pending", "2026-11-12T14:00:00.000Z", "ready", "inferred");
    expect(latestReadyRecap([olderPending, confirmed])?.id).toBe("confirmed-newest");
  });

  it("surfaces only an inferred newest recap that is newer than the session watermark", () => {
    const latest = interval("latest", "2026-11-12T15:00:00.000Z", "ready", "inferred");
    expect(recapSurfaceDecision({ latest, watermark: null, pendingRecap: null }).surface).toBe(true);
    expect(recapSurfaceDecision({ latest, watermark: "2026-11-12T15:00:00.000Z", pendingRecap: null }).surface).toBe(false);
    expect(recapSurfaceDecision({ latest: { ...latest, reviewStatus: "confirmed" }, watermark: null, pendingRecap: null })).toMatchObject({ surface: false, reason: "approved" });
    expect(recapSurfaceDecision({ latest, watermark: null, pendingRecap: { ...latest, id: "newer-chat", windowStart: "2026-11-12T16:00:00.000Z" } })).toMatchObject({ surface: false, reason: "already_pending" });
  });

  it("never moves the session watermark backward", () => {
    const approvedOlder = interval("approved-older", "2026-11-12T15:00:00.000Z", "ready", "confirmed");
    expect(recapSurfaceDecision({ latest: approvedOlder, watermark: "2026-11-12T16:00:00.000Z", pendingRecap: null }).watermark).toBe("2026-11-12T16:00:00.000Z");
    const pendingOlder = interval("pending-older", "2026-11-12T15:00:00.000Z", "ready", "inferred");
    expect(recapSurfaceDecision({ latest: pendingOlder, watermark: "2026-11-12T16:00:00.000Z", pendingRecap: pendingOlder }).watermark).toBe("2026-11-12T16:00:00.000Z");
  });
});

describe("post-approval recap queue bubble", () => {
  it("stays up when the latest poll reports the approved newest recap", () => {
    let state = reduceRecapQueueBubble({ prompt: false, awaitingBeat: false }, { type: "approved" });
    state = reduceRecapQueueBubble(state, { type: "celebration-ended", pendingCount: 2 });
    expect(state.prompt).toBe(true);
    state = reduceRecapQueueBubble(state, { type: "pending-count", pendingCount: 2 });
    expect(state.prompt).toBe(true);
  });

  it("hides when the queue is empty or the employee opens it", () => {
    const shown = reduceRecapQueueBubble({ prompt: true, awaitingBeat: false }, { type: "pending-count", pendingCount: 0 });
    expect(shown.prompt).toBe(false);
    expect(reduceRecapQueueBubble({ prompt: true, awaitingBeat: false }, { type: "opened" }).prompt).toBe(false);
    expect(reduceRecapQueueBubble({ prompt: true, awaitingBeat: false }, { type: "surfaced" }).prompt).toBe(false);
  });

  it("renders only with remaining recaps and no other bubble", () => {
    expect(unapprovedRecapsBubbleVisible({ prompt: true, awaitingBeat: false }, 2, null)).toBe(true);
    expect(unapprovedRecapsBubbleVisible({ prompt: true, awaitingBeat: false }, 0, null)).toBe(false);
    expect(unapprovedRecapsBubbleVisible({ prompt: true, awaitingBeat: false }, 2, "recap")).toBe(false);
  });
});

describe("memory candidate notifications", () => {
  it("tracks only candidates, in stable order", () => {
    expect(memoryCandidateIds([fact("b", "candidate"), fact("a", "confirmed"), fact("c", "candidate")])).toEqual(["b", "c"]);
    expect(memoryCandidateIds(undefined)).toEqual([]);
  });

  it("announces only ids the registry has never seen", () => {
    expect(unseenMemoryIds(["a", "b"], ["a"])).toEqual(["b"]);
    expect(unseenMemoryIds(["a"], ["a", "b"])).toEqual([]);
    expect(unseenMemoryIds([], [])).toEqual([]);
  });

  it("merges without duplicates and bounds the registry", () => {
    expect(mergeSeenIds(["a"], ["a", "b"])).toEqual(["a", "b"]);
    const many = Array.from({ length: 130 }, (_, index) => `id-${index}`);
    expect(mergeSeenIds([], many)).toHaveLength(120);
    expect(mergeSeenIds([], many).at(-1)).toBe("id-129");
  });
});

describe("ready recap selection", () => {
  it("picks the newest ready interval still awaiting review", () => {
    const recap = readyRecap([
      interval("older", "2026-10-07T13:00:00Z", "ready", "inferred"),
      interval("newer", "2026-10-07T14:00:00Z", "ready", "inferred"),
      interval("confirmed", "2026-10-07T15:00:00Z", "ready", "confirmed"),
      interval("preparing", "2026-10-07T16:00:00Z", "preparing", "inferred"),
    ]);
    expect(recap?.id).toBe("newer");
  });

  it("has nothing to surface when every recap is decided or unfinished", () => {
    expect(readyRecap([interval("confirmed", "2026-10-07T15:00:00Z", "ready", "confirmed")])).toBeNull();
    expect(readyRecap([interval("failed", "2026-10-07T15:00:00Z", "failed", "inferred")])).toBeNull();
    expect(readyRecap(undefined)).toBeNull();
  });

});

describe("overdue notifications", () => {
  it("keys an announcement to the task and its due date", () => {
    expect(overdueNotifyKey({ id: "task-1", dueDate: "2026-10-10" })).toBe("overdue:task-1:2026-10-10");
    expect(unseenOverdueKeys(["overdue:task-1:2026-10-10", "overdue:task-2:2026-10-11"], ["overdue:task-1:2026-10-10"])).toEqual(["overdue:task-2:2026-10-11"]);
  });

  it("names the count in the singular and plural", () => {
    expect(overdueSummary(1)).toBe("1 task is overdue");
    expect(overdueSummary(3)).toBe("3 tasks are overdue");
  });

  it("never rotates a current overdue key out of the registry", () => {
    const many = Array.from({ length: 130 }, (_, index) => `overdue:task-${index}:2026-10-10`);
    const merged = mergeOverdueKeys([], many);
    expect(merged).toHaveLength(130);
    for (const key of many) expect(merged).toContain(key);
    // Older keys still age out of the bounded registry.
    const older = Array.from({ length: 200 }, (_, index) => `overdue:old-${index}:2026-10-01`);
    const bounded = mergeOverdueKeys(older, many.slice(0, 5));
    expect(bounded).toHaveLength(120);
    for (const key of many.slice(0, 5)) expect(bounded).toContain(key);
    // A current key already present is not duplicated.
    expect(mergeOverdueKeys(["overdue:a:2026-10-10"], ["overdue:a:2026-10-10"])).toEqual(["overdue:a:2026-10-10"]);
  });
});

describe("badge counts", () => {
  it("counts memories, one recap slot, overdue tasks, and outstanding days together", () => {
    expect(notificationsBadgeCount({ memoryCandidates: 3, recapReady: true, overdueTasks: 2, outstandingEodDays: 2 })).toBe(8);
    expect(notificationsBadgeCount({ memoryCandidates: 0, recapReady: false, overdueTasks: 0, outstandingEodDays: 0 })).toBe(0);
  });
});
