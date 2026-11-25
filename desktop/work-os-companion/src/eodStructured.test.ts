import { describe, expect, it } from "vitest";
import * as shared from "@wrazy/work-os-shared/eod-structured";
import {
  EOD_STRUCTURED_VERSION,
  createSaveFlight,
  eodCompositionIsComplete,
  eodCompositionSignature,
  eodStructuredFromReport,
  eodSummaryIsCurrent,
  eodSummaryMode,
  normalizeLoomShareUrl,
  saveFailureNotice,
  shouldPrepareStructuredEod,
} from "./eodStructured";

const composition = { completed: ["Shipped the handoff"], inProgress: ["Review is open"], next: ["Send the note"] };

describe("companion structured EOD helpers", () => {
  it("selects structured only at version 1", () => {
    expect(eodStructuredFromReport({ structured_report: { version: 1, completed: [], inProgress: [], next: [], suggestions: { completed: [], inProgress: [], next: [] }, evidence: [] } })).not.toBeNull();
    expect(eodStructuredFromReport({ structured_report: { version: 0 } })).toBeNull();
    expect(eodStructuredFromReport({ markdown: "# legacy" })).toBeNull();
    expect(eodStructuredFromReport(null)).toBeNull();
  });

  it("keeps the summary current only for the exact composition", () => {
    const signature = eodCompositionSignature(composition);
    expect(eodSummaryIsCurrent({ ...composition, summary: "A finished day.", summarySignature: signature })).toBe(true);
    expect(eodSummaryIsCurrent({ ...composition, summary: "A finished day.", summarySignature: "stale" })).toBe(false);
    expect(eodCompositionIsComplete({ ...composition, completed: [] })).toBe(false);
  });

  it("reports summary modes in the order the composer uses", () => {
    expect(eodSummaryMode({ completed: [], inProgress: [], next: [], summary: "", summarySignature: null })).toBe("empty");
    expect(eodSummaryMode({ ...composition, summary: "", summarySignature: null })).toBe("ready");
    expect(eodSummaryMode({ ...composition, summary: "", summarySignature: null, writing: true })).toBe("writing");
    expect(eodSummaryMode({ ...composition, summary: "Stale", summarySignature: "old" })).toBe("stale");
    expect(eodSummaryMode({ ...composition, summary: "Current", summarySignature: eodCompositionSignature(composition) })).toBe("done");
  });

  it("serialises saves and runs the newest snapshot after the first finishes", async () => {
    const calls: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const flight = createSaveFlight<number>(async (value) => {
      calls.push(value);
      if (value === 1) await gate;
    });
    const first = flight(1);
    await expect(flight(2)).resolves.toBe("deferred");
    release();
    await first;
    expect(calls).toEqual([1, 2]);
  });

  it("keeps a save conflict message and promises the buffer is still there", () => {
    expect(saveFailureNotice(new Error("The report changed while it was being saved. Reload it before editing again."))).toEqual({
      tone: "error",
      text: "The report changed while it was being saved. Reload it before editing again.",
      conflict: false,
    });
    expect(saveFailureNotice(Object.assign(new Error("The report changed on another device."), { status: 409 })).conflict).toBe(true);
    expect(saveFailureNotice(null).text).toContain("still here");
  });

  it("prepares only today's unsubmitted draft without a structured payload", () => {
    expect(shouldPrepareStructuredEod({ report_date: "2026-11-25", status: "draft" }, "2026-11-25")).toBe(true);
    expect(shouldPrepareStructuredEod({ report_date: "2026-11-25", status: "rejected" }, "2026-11-25")).toBe(false);
    expect(shouldPrepareStructuredEod({ report_date: "2026-11-25", status: "draft", submitted_at: "2026-11-25T17:00:00Z" }, "2026-11-25")).toBe(false);
    expect(shouldPrepareStructuredEod({ report_date: "2026-11-24", status: "draft" }, "2026-11-25")).toBe(false);
    expect(shouldPrepareStructuredEod({ report_date: "2026-11-25", status: "draft", structured_report: { version: 1 } }, "2026-11-25")).toBe(false);
  });

  it("pins the mirrored contract version", () => {
    expect(EOD_STRUCTURED_VERSION).toBe(shared.EOD_STRUCTURED_VERSION);
  });

  it("matches the web normalization and signature exactly", () => {
    for (const value of ["loom.com/share/0123456789abcdef0123456789abcdef", "https://www.loom.com/share/0123456789ABCDEF0123456789ABCDEF", "https://example.com/share/0123456789abcdef0123456789abcdef", "not a url"]) {
      expect(normalizeLoomShareUrl(value)).toBe(shared.normalizeLoomShareUrl(value));
    }
    expect(eodCompositionSignature(composition)).toBe(shared.eodCompositionSignature(composition));
  });
});
