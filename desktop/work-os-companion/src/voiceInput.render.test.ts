import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressComposer } from "./App";
import { VOICE_FAILURE_COPY, type VoiceInput, type VoiceState } from "./chat/voiceInput";

const base = {
  input: "",
  open: true,
  panel: "update" as const,
  pending: "",
  receipt: null,
  history: [],
  onClearChat: () => undefined,
  busy: false,
  required: false,
  goal: "",
  goalProvenance: null as null,
  goalSuggestion: null,
  saveState: "saved" as const,
  onInput: () => undefined,
  onOpen: () => undefined,
  onOpenGoal: () => undefined,
  onClose: () => undefined,
  onSubmit: () => undefined,
  onClassify: () => undefined,
  onApplyGoal: () => undefined,
};

function voiceStub(state: VoiceState, overrides: Partial<VoiceInput> = {}): VoiceInput {
  return {
    state,
    level: state === "recording" ? 0.62 : 0,
    elapsedMs: state === "recording" ? 7_400 : 0,
    maxMs: 120_000,
    error: null,
    receipt: false,
    supported: true,
    dismissError: () => undefined,
    start: () => undefined,
    stop: () => undefined,
    cancel: () => undefined,
    ...overrides,
  };
}

/** The composer's voice surface, rendered for every capture state. */
describe("voice input rendering", () => {
  it("offers record in the send slot only while the draft is empty", () => {
    const empty = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      voice: voiceStub("idle"),
    }));
    expect(empty).toContain("Record a voice update (hold Ctrl + M)");
    expect(empty).toContain('aria-keyshortcuts="Control+M"');
    expect(empty).toContain('data-voice-state="idle"');

    const typed = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      input: "Shipped the audit fix.",
      voice: voiceStub("idle"),
    }));
    expect(typed).not.toContain("Record a voice update");
    expect(typed).toContain('aria-label="Review update type"');
    expect(typed).toContain('aria-keyshortcuts="Enter"');
  });

  it("keeps the send control, and never a record control, when voice is unavailable", () => {
    const hidden = renderToStaticMarkup(createElement(ProgressComposer, { ...base }));
    expect(hidden).not.toContain("Record a voice update");
    expect(hidden).toContain("</textarea>");

    const unsupported = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      voice: voiceStub("idle", { supported: false }),
    }));
    expect(unsupported).not.toContain("Record a voice update");
  });

  it("replaces the field with a capture row while recording", () => {
    const markup = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      voice: voiceStub("recording"),
    }));
    expect(markup).toContain('data-voice-state="recording"');
    expect(markup).toContain('aria-label="Stop recording"');
    expect(markup).toContain('aria-label="Cancel recording"');
    expect(markup).toContain("Hold Ctrl + M to talk");
    /* The clock reads the real elapsed time against the two-minute bound. */
    expect(markup).toContain("0:07 / 2:00");
    /* The live region says the capture is live, not just that a color changed. */
    expect(markup).toContain("Recording your voice update");
    /* Recording owns the row: no field to type into and no send to fire. */
    expect(markup).not.toContain("</textarea>");
    expect(markup).not.toContain('aria-label="Review update type"');
    /* The capture row is the state. The owning conversation surface strips the
       composer's own chrome, so no shell border can be the cue. */
    expect(markup).not.toContain("border-signal-strong");
    expect(markup).toContain("border-line");
  });

  it("asks for the microphone and shows the spinner while transcribing", () => {
    const requesting = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      voice: voiceStub("requesting"),
    }));
    expect(requesting).toContain("Waiting for the microphone…");
    expect(requesting).toContain('aria-label="Cancel recording"');

    const transcribing = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      voice: voiceStub("transcribing"),
    }));
    expect(transcribing).toContain("Transcribing…");
    expect(transcribing).toContain("Transcribing your recording");
    expect(transcribing).not.toContain('aria-label="Stop recording"');
    /* The clip is already uploaded: offering a cancel that cannot abort the
       request would be a control that lies about what it does. */
    expect(transcribing).not.toContain('aria-label="Cancel recording"');
    expect(transcribing).not.toContain("Hold Ctrl + M to talk");
  });

  it("states the receipt and every failure in words outside the shell", () => {
    const receipt = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      voice: voiceStub("idle", { receipt: true }),
    }));
    expect(receipt).toContain("Transcribed — review it, then send.");

    const failed = renderToStaticMarkup(createElement(ProgressComposer, {
      ...base,
      voice: voiceStub("idle", { error: VOICE_FAILURE_COPY.permission }),
    }));
    expect(failed).toContain("Microphone access is blocked");
    expect(failed).toContain("Dismiss voice input message");
    expect(failed).not.toContain("Transcribed — review it, then send.");
  });
});
