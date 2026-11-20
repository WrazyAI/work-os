import { describe, expect, it } from "vitest";
import { normalizeEvidence } from "./data";

describe("evidence summary normalization", () => {
  it("keeps exact kind counts, the people count, and the coverage matrix", () => {
    const normalized = normalizeEvidence({
      evidence: [],
      summary: {
        sources: [{ source: "ghl", count: 179 }],
        days: [{ date: "2026-11-16", count: 102 }],
        kinds: [
          { kind: "call", count: 178 },
          { kind: "email", count: 1 },
        ],
        peopleCount: 1,
        peopleByBucket: { calls: 1, emails: 1, texts: 0, work: 0, context: 0 },
        coverage: {
          people: [
            {
              personId: "person-aden",
              days: [{ date: "2026-11-16", count: 102, emails: 1 }],
            },
            {
              personId: null,
              days: [{ date: "2026-11-18", count: 5, emails: 0 }],
            },
          ],
        },
      },
    });

    expect(normalized.summary).toEqual({
      sources: [{ source: "ghl", count: 179 }],
      days: [{ date: "2026-11-16", count: 102 }],
      kinds: [
        { kind: "call", count: 178 },
        { kind: "email", count: 1 },
      ],
      peopleCount: 1,
      peopleByBucket: { calls: 1, emails: 1, texts: 0, work: 0, context: 0 },
      coverage: {
        people: [
          { personId: "person-aden", days: [{ date: "2026-11-16", count: 102, emails: 1 }] },
          { personId: null, days: [{ date: "2026-11-18", count: 5, emails: 0 }] },
        ],
      },
    });
  });

  it("leaves older summary payloads without invented fields", () => {
    const normalized = normalizeEvidence({
      evidence: [],
      summary: { sources: [], days: [] },
    });
    expect(normalized.summary?.kinds).toBeUndefined();
    expect(normalized.summary?.peopleCount).toBeUndefined();
    expect(normalized.summary?.coverage).toBeUndefined();
  });
});
