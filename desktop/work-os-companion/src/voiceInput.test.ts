import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import { isVoiceTransportFailure, VOICE_FAILURE_COPY, voiceFailureCopy } from "./chat/voiceInput";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const voiceSource = readFileSync(resolve(root, "src/chat/voiceInput.ts"), "utf8").replace(/\r\n/g, "\n");
const apiSource = readFileSync(resolve(root, "src/api.ts"), "utf8").replace(/\r\n/g, "\n");

describe("voice upload resilience", () => {
  it("only treats a response-less transport failure as retryable", () => {
    expect(isVoiceTransportFailure(new ApiRequestError("Failed to fetch", null, true))).toBe(true);
    expect(isVoiceTransportFailure(new ApiRequestError("Transcription took too long.", 504, true))).toBe(false);
    expect(isVoiceTransportFailure(new ApiRequestError("Connect this device to WrazyOS.", 401, false))).toBe(false);
    expect(isVoiceTransportFailure(new TypeError("Failed to fetch"))).toBe(false);
    expect(isVoiceTransportFailure(null)).toBe(false);
  });

  it("never shows the raw transport text to the employee", () => {
    /* "Failed to fetch" tells the employee nothing they can act on. */
    expect(voiceFailureCopy(new ApiRequestError("Failed to fetch", null, true))).toBe(VOICE_FAILURE_COPY.network);
    expect(voiceFailureCopy(new DOMException("The operation timed out", "TimeoutError"))).toBe(VOICE_FAILURE_COPY.transcribe);
    /* A failure the workspace did answer keeps the workspace's own wording. */
    expect(voiceFailureCopy(new ApiRequestError("Transcription took too long. Try a shorter recording.", 504, true)))
      .toBe("Transcription took too long. Try a shorter recording.");
    expect(voiceFailureCopy(new Error(""))).toBe(VOICE_FAILURE_COPY.transcribe);
  });

  it("names every upload boundary and retries the clip exactly once", () => {
    expect(voiceSource).toContain("voice.upload.prepared");
    expect(voiceSource).toContain("voice.upload.blob_read");
    expect(voiceSource).toContain("voice.upload.transport_failed");
    expect(voiceSource).toContain("voice.upload.probe");
    expect(voiceSource).toContain("voice.upload.retry");
    /* The retry sends the clip a second time and never a third. */
    expect((voiceSource.match(/await send\(\)/g) ?? []).length).toBe(2);
    /* A transport failure names the host it was addressed to. */
    expect(apiSource).toContain("api.request.transport_failed");
  });
});
