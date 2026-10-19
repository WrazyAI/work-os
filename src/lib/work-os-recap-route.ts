import { NextResponse } from "next/server";
import {
  DEFAULT_RECAP_VOICE,
  buildRecapSpeechLines,
  recapSpeechConfigured,
  recapSpeechFailureCopy,
  speakRecap,
  type RecapSpeechFailure,
  type RecapSpeechLine,
} from "@/lib/work-os-recap-speech";
import {
  getActivityIntervalForPerson,
  intervalRevision,
  intervalSpeechSource,
  type ActivityIntervalRecord,
} from "@/lib/work-os-activity-intervals";
import { jsonError, requireWorkOsAccess, type WorkOsAccess } from "@/lib/work-os-api";

/** Voice output is gated exactly like voice input: one capability, both
 * directions (the UI names it "Voice input & output"). */
const VOICE_FEATURE_FLAG = "voice_input";

const FAILURE_STATUS: Record<RecapSpeechFailure, number> = {
  not_configured: 503,
  empty: 422,
  too_long: 422,
  provider_error: 502,
  timeout: 504,
  malformed: 502,
};

/** What the route needs from the rest of the app. The defaults are the real
 * modules; tests pass stubs, the same way the transcriber's tests do. */
export type RecapSpeechRouteDeps = {
  authorize: (request: Request) => Promise<{ response?: NextResponse; access?: WorkOsAccess }>;
  configured: () => boolean;
  loadInterval: (access: WorkOsAccess, intervalId: string) => Promise<ActivityIntervalRecord | null>;
  speak: typeof speakRecap;
};

const liveDeps: RecapSpeechRouteDeps = {
  authorize: (request) => requireWorkOsAccess({
    organizationId: request.headers.get("x-work-os-organization-id"),
    authorization: request.headers.get("authorization"),
    requirePerson: true,
    feature: VOICE_FEATURE_FLAG,
  }),
  configured: recapSpeechConfigured,
  loadInterval: getActivityIntervalForPerson,
  speak: speakRecap,
};

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

// POST /api/work-os/voice/recap
// Body: { intervalId, revision?, voice? }
//
// Reads one recap aloud. The body carries an id, never text: an organisation's
// text-to-speech bill must never be a way to speak arbitrary strings, and the
// words that come back are the recap's own — which is what lets the prompter
// show exactly what is being said.
//
// The response is the WAV itself, with the spoken lines and the revision they
// belong to in headers. When the client sends a revision the recap has moved on
// from, the headers carry the current one plus `x-work-os-recap-stale: 1`, so
// the companion can refresh the card before playing rather than playing words
// the card no longer shows.
export async function handleRecapSpeech(
  request: Request,
  deps: RecapSpeechRouteDeps = liveDeps,
): Promise<NextResponse> {
  try {
    const auth = await deps.authorize(request);
    if (auth.response) return auth.response;
    const access = auth.access;
    if (!access) return fail("authentication required", 401);

    if (!deps.configured()) {
      return fail(recapSpeechFailureCopy("not_configured"), FAILURE_STATUS.not_configured);
    }

    const body = await request.json().catch(() => null) as
      | { intervalId?: unknown; revision?: unknown; voice?: unknown }
      | null;
    const intervalId = typeof body?.intervalId === "string" ? body.intervalId.trim() : "";
    if (!intervalId) return fail("That recap is no longer available.", 404);
    const requestedRevision = Number.isFinite(Number(body?.revision)) ? Math.floor(Number(body?.revision)) : null;
    const voice = typeof body?.voice === "string" && body.voice.trim() ? body.voice.trim() : DEFAULT_RECAP_VOICE;

    const row = await deps.loadInterval(access, intervalId);
    if (!row) return fail("That recap is no longer available.", 404);

    const revision = intervalRevision(row);
    let lines: RecapSpeechLine[];
    try {
      lines = buildRecapSpeechLines(intervalSpeechSource(row));
    } catch {
      return fail(recapSpeechFailureCopy("too_long"), FAILURE_STATUS.too_long);
    }
    if (!lines.length) return fail(recapSpeechFailureCopy("empty"), FAILURE_STATUS.empty);

    const result = await deps.speak({ intervalId, revision, voice, lines });
    if (!result.ok) return fail(recapSpeechFailureCopy(result.reason), FAILURE_STATUS[result.reason]);

    // Copy into a fresh ArrayBuffer-backed view: the provider hands back a
    // Uint8Array<ArrayBufferLike>, and the newer BodyInit types only accept
    // ArrayBuffer-backed views.
    const bytes = new Uint8Array(result.audio.byteLength);
    bytes.set(result.audio);
    return new NextResponse(new Blob([bytes], { type: result.mimeType }), {
      status: 200,
      headers: {
        "content-type": result.mimeType,
        "cache-control": "no-store",
        "x-work-os-recap-voice": result.voice,
        "x-work-os-recap-revision": String(revision),
        "x-work-os-recap-lines": encodeURIComponent(JSON.stringify(lines)),
        ...(requestedRevision !== null && requestedRevision !== revision ? { "x-work-os-recap-stale": "1" } : {}),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
