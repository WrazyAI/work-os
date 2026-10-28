import type { TranscribeFailure } from "@/lib/aiTranscribe";

/** The employee- and admin-facing copy for a failed transcription. One source
 * so the admin adapter cannot drift from the employee route. Never a provider
 * payload, status code, or the audio itself (design §8.8/§9). */
export const TRANSCRIBE_FAILURE_COPY: Record<TranscribeFailure, { status: number; error: string }> = {
  not_configured: { status: 503, error: "Voice input is not available in this workspace yet." },
  empty_audio: { status: 422, error: "We didn't catch any speech. Try again and speak for at least a second." },
  too_large: { status: 413, error: "That recording is too long. Keep it under two minutes." },
  unsupported_audio: { status: 415, error: "That audio format can't be transcribed." },
  timeout: { status: 504, error: "Transcription took too long. Try a shorter recording." },
  provider_error: { status: 502, error: "Transcription is unavailable right now. Try again in a moment." },
  malformed: { status: 502, error: "Transcription came back unreadable. Try again." },
};
