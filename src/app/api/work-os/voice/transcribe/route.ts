import { NextResponse } from "next/server";
import {
  readVoiceUpload,
  transcribeAudio,
  voiceInputConfigured,
  type TranscribeFailure,
} from "@/lib/aiTranscribe";
import { requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Voice input is gated per organization/employee like every other Work OS
 * capability; the record control only renders when this flag is on. */
const VOICE_FEATURE_FLAG = "voice_input";

/** Employee-facing copy for each failure. Never leaks provider payloads,
 * status codes, or the audio itself (design §9 error copy). */
const FAILURE_COPY: Record<TranscribeFailure, { status: number; error: string }> = {
  not_configured: { status: 503, error: "Voice input is not available in this workspace yet." },
  empty_audio: { status: 422, error: "We didn't catch any speech. Try again and speak for at least a second." },
  too_large: { status: 413, error: "That recording is too long. Keep it under two minutes." },
  unsupported_audio: { status: 415, error: "That audio format can't be transcribed." },
  timeout: { status: 504, error: "Transcription took too long. Try a shorter recording." },
  provider_error: { status: 502, error: "Transcription is unavailable right now. Try again in a moment." },
  malformed: { status: 502, error: "Transcription came back unreadable. Try again." },
};

// POST /api/work-os/voice/transcribe
// Body: multipart/form-data with field `audio` (the MediaRecorder output).
// Optional fields: `language` (ISO 639-1), `mime` (the recorder's own type,
// because a multipart part may arrive without one).
//
// The clip is forwarded straight to the provider and dropped; nothing is
// written to disk or to the database.
export async function POST(req: Request) {
  const auth = await requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: VOICE_FEATURE_FLAG,
  });
  if (auth.response) return auth.response;
  if (!voiceInputConfigured()) {
    return NextResponse.json({ error: FAILURE_COPY.not_configured.error }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const upload = await readVoiceUpload(form);
  if (!upload.ok) {
    const copy = FAILURE_COPY[upload.reason];
    return NextResponse.json({ error: copy.error, reason: upload.reason }, { status: copy.status });
  }

  const result = await transcribeAudio({
    bytes: upload.bytes,
    mime: upload.mime,
    language: form.get("language"),
  });

  if (!result.ok) {
    const copy = FAILURE_COPY[result.reason];
    return NextResponse.json(
      { error: copy.error, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) },
      { status: copy.status },
    );
  }

  return NextResponse.json({ text: result.text, model: result.model });
}
