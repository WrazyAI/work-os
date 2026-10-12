import { describe, expect, it } from "vitest";
import { CHAT_DIVIDER_GAP_MS, formatChatClock, formatChatDividerLabel, formatChatTimeTitle, shouldShowChatDivider } from "./timeNotes";

/** ICU may emit a narrow no-break space before AM/PM; compare on a plain space. */
const text = (value: string | null) => value?.replace(/\u202f/g, " ") ?? null;

const NOW = new Date("2026-10-12T20:00:00Z");
const UTC = { timeZone: "UTC" } as const;

describe("chat clock labels", () => {
  it("renders the employee-local 12-hour clock", () => {
    expect(text(formatChatClock("2026-10-12T17:48:00Z", UTC))).toBe("5:48 PM");
    expect(text(formatChatClock("2026-10-12T05:03:00Z", UTC))).toBe("5:03 AM");
    expect(text(formatChatClock("2026-10-12T00:07:00Z", UTC))).toBe("12:07 AM");
    expect(text(formatChatClock("2026-10-12T12:00:00Z", UTC))).toBe("12:00 PM");
  });

  it("never invents a time for missing or malformed values", () => {
    expect(formatChatClock(null)).toBeNull();
    expect(formatChatClock(undefined)).toBeNull();
    expect(formatChatClock("")).toBeNull();
    expect(formatChatClock("not-a-date")).toBeNull();
    expect(formatChatDividerLabel("not-a-date", NOW, UTC)).toBeNull();
    expect(formatChatTimeTitle("not-a-date", NOW, UTC)).toBeNull();
  });

  it("labels dividers by relative day and local time", () => {
    expect(text(formatChatDividerLabel("2026-10-12T17:48:00Z", NOW, UTC))).toBe("Today 5:48 PM");
    expect(text(formatChatDividerLabel("2026-10-11T09:03:00Z", NOW, UTC))).toBe("Yesterday 9:03 AM");
    expect(text(formatChatDividerLabel("2026-10-07T09:03:00Z", NOW, UTC))).toBe("Wednesday 9:03 AM");
    expect(text(formatChatDividerLabel("2026-10-06T09:03:00Z", NOW, UTC))).toBe("Tuesday 9:03 AM");
    expect(text(formatChatDividerLabel("2026-10-05T09:03:00Z", NOW, UTC))).toBe("October 5, 9:03 AM");
    expect(text(formatChatDividerLabel("2025-09-30T09:03:00Z", NOW, UTC))).toBe("September 30 ’25, 9:03 AM");
  });

  it("titles a hover time with its full local date", () => {
    expect(text(formatChatTimeTitle("2026-10-07T09:03:00Z", NOW, UTC))).toBe("Wednesday, October 7, 9:03 AM");
  });
});

describe("chat session dividers", () => {
  const user = (createdAt?: string) => ({ role: "user", createdAt });
  const assistant = (createdAt?: string) => ({ role: "assistant", createdAt });

  it("marks the first employee message and pauses longer than twenty minutes", () => {
    const entries = [
      assistant("2026-10-12T17:00:00Z"),
      user("2026-10-12T17:01:00Z"), // opens the conversation
      assistant("2026-10-12T17:02:00Z"),
      user("2026-10-12T17:21:00Z"), // 19 minutes later
      assistant("2026-10-12T17:22:00Z"),
      user("2026-10-12T17:42:00Z"), // exactly 20 minutes later
      assistant("2026-10-12T17:43:00Z"),
      user("2026-10-12T18:31:00Z"), // 48 minutes later
    ];
    expect(shouldShowChatDivider(entries, 1)).toBe(true);
    expect(shouldShowChatDivider(entries, 3)).toBe(false);
    expect(shouldShowChatDivider(entries, 5)).toBe(false);
    expect(shouldShowChatDivider(entries, 7)).toBe(true);
    expect(CHAT_DIVIDER_GAP_MS).toBe(20 * 60 * 1000);
  });

  it("skips untimed turns when measuring the gap", () => {
    const entries = [
      user("2026-10-12T17:00:00Z"),
      assistant(),
      user("2026-10-12T17:05:00Z"),
      assistant(),
      user("2026-10-12T17:45:00Z"),
    ];
    expect(shouldShowChatDivider(entries, 2)).toBe(false);
    expect(shouldShowChatDivider(entries, 4)).toBe(true); // measured from 17:05, not the untimed turns
  });

  it("never divides agent or timeless turns", () => {
    expect(shouldShowChatDivider([assistant("2026-10-12T17:00:00Z")], 0)).toBe(false);
    expect(shouldShowChatDivider([user("nope")], 0)).toBe(false);
    expect(shouldShowChatDivider([], 0)).toBe(false);
  });
});
