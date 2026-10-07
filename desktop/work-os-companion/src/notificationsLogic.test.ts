import { describe, expect, it } from "vitest";
import { memoryCandidateIds, mergeSeenIds, notificationsBadgeCount, notificationsSummary, readyRecap, recapNotifyKey, unseenMemoryIds } from "./notificationsLogic";
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

  it("keys a notification to the exact interval", () => {
    expect(recapNotifyKey("interval-1")).toBe("recap:interval-1");
  });
});

describe("badge and headline counts", () => {
  it("counts memories, one recap slot, and outstanding days together", () => {
    expect(notificationsBadgeCount({ memoryCandidates: 3, recapReady: true, outstandingEodDays: 2 })).toBe(6);
    expect(notificationsBadgeCount({ memoryCandidates: 0, recapReady: false, outstandingEodDays: 0 })).toBe(0);
  });

  it("names what is waiting for the panel headline", () => {
    expect(notificationsSummary({ memoryCandidates: 1, recapReady: false, outstandingEodDays: 0 })).toBe("1 memory to review");
    expect(notificationsSummary({ memoryCandidates: 2, recapReady: true, outstandingEodDays: 3 })).toBe("2 memories to review · a recap to review · 3 prior EODs");
    expect(notificationsSummary({ memoryCandidates: 0, recapReady: false, outstandingEodDays: 0 })).toBe("You're caught up");
  });
});
