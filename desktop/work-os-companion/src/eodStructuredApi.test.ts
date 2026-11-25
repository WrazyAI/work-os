import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequestRaw, sendOrQueue } from "./api";
import { eodSavePayload, eodSubmitPayload, streamEodSummary, submitStructuredEod } from "./eodStructuredApi";

vi.mock("./api", () => ({
  apiRequest: vi.fn(),
  apiRequestRaw: vi.fn(),
  sendOrQueue: vi.fn(),
}));

const input = {
  completed: ["Shipped"],
  inProgress: ["Review"],
  next: ["Send"],
  summary: "Done.",
  summaryGeneratedAt: "2026-11-25T17:00:00.000Z",
  summarySource: "otto" as const,
  summarySignature: "abc",
  loomUrl: "https://www.loom.com/share/0123456789abcdef0123456789abcdef",
};

afterEach(() => vi.clearAllMocks());

describe("companion structured EOD API", () => {
  it("builds the save and submit payloads the web uses", () => {
    expect(eodSavePayload(input)).toEqual(input);
    expect(eodSubmitPayload(input, "key-1")).toEqual({ structured: input, submission_idempotency_key: "key-1" });
  });

  it("streams summary chunks and reports the source", async () => {
    vi.mocked(apiRequestRaw).mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("A day "));
        controller.enqueue(new TextEncoder().encode("of work."));
        controller.close();
      },
    }), { headers: { "X-Work-OS-Summary-Source": "otto" } }));
    const chunks: string[] = [];
    const result = await streamEodSummary("2026-11-25", input, (chunk) => chunks.push(chunk), new AbortController().signal);
    expect(chunks.join("")).toBe("A day of work.");
    expect(result.source).toBe("otto");
  });

  it("stops reading when the caller aborts a stalled stream", async () => {
    vi.mocked(apiRequestRaw).mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const controller = new AbortController();
    const pending = streamEodSummary("2026-11-25", input, () => {}, controller.signal);
    setTimeout(() => controller.abort(), 0);
    await expect(pending).rejects.toThrow();
  });

  it("passes a queued submit through unchanged", async () => {
    vi.mocked(sendOrQueue).mockResolvedValue({ queued: true });
    await expect(submitStructuredEod("r-1", input, "key-1")).resolves.toEqual({ queued: true });
  });
});
