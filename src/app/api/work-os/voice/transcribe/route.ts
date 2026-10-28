import { NextResponse } from "next/server";
import {
  readVoiceUpload,
  transcribeAudio,
  voiceInputConfigured,
} from "@/lib/aiTranscribe";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { TRANSCRIBE_FAILURE_COPY as FAILURE_COPY } from "@/lib/work-os-voice-failure-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Voice input is gated per organization/employee like every other Work OS
 * capability; the record control only renders when this flag is on. */
const VOICE_FEATURE_FLAG = "voice_input";

// POST /api/work-os/voice/transcribe
// Body: multipart/form-data with field `audio` (the MediaRecorder output).
// Optional fields: `language` (ISO 639-1), `mime` (the recorder's own type,
// because a multipart part may arrive without one).
//
// The clip is forwarded straight to the provider and dropped; nothing is
// written to disk or to the database.
export async function POST(req: Request) {
  try {
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
  } catch (error) {
    /* Every other Work OS route funnels unexpected throws through jsonError so
       a failure is diagnosable; without this the client only ever sees an
       opaque 500 with no error field. */
    return jsonError(error);
  }
}
