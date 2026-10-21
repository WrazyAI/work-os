import { NextResponse } from "next/server";
import {
  DEFAULT_RECAP_VOICE,
  RECAP_VOICES,
  recapSpeechConfigured,
  recapSpeechFailureCopy,
  type RecapSpeechFailure,
  type RecapSpeechLine,
} from "@/lib/work-os-recap-speech";
import { buildNextStepsSpeechLines, speakNextSteps } from "@/lib/work-os-next-steps-speech";
import { listRecapNextSteps } from "@/lib/work-os-next-steps";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The part of the recap's next-steps read the speech route needs. Kept
 * structural so a stub can supply it without the whole chat view. */
export type NextStepsMomentView = {
  status: string;
  label: string | null;
  items: Array<{
    proposalId: string;
    operation: string;
    status: string;
    title: string;
    rationale: string;
    taskId: string | null;
    editable: boolean;
  }>;
};

/** What the route needs from the rest of the app. The defaults are the real
 * modules; tests pass stubs, the same way the recap route's tests do. */
export type NextStepsSpeechRouteDeps = {
  authorize: (request: Request) => Promise<{ response?: NextResponse; access?: WorkOsAccess }>;
  configured: () => boolean;
  loadMoment: (access: WorkOsAccess, intervalId: string) => Promise<NextStepsMomentView | null>;
  speak: typeof speakNextSteps;
};

const liveDeps: NextStepsSpeechRouteDeps = {
  authorize: (request) => requireWorkOsAccess({
    organizationId: request.headers.get("x-work-os-organization-id"),
    authorization: request.headers.get("authorization"),
    requirePerson: true,
    feature: VOICE_FEATURE_FLAG,
  }),
  configured: recapSpeechConfigured,
  loadMoment: listRecapNextSteps,
  speak: speakNextSteps,
};

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** A stable fingerprint of the suggestions being read. A regenerated set has a
 * different signature, so it is synthesised again instead of reusing the clip
 * made for the old one. */
function suggestionSignature(items: NextStepsMomentView["items"]): string {
  return items
    .map((item) => `${item.proposalId}:${item.operation}:${item.title}:${item.rationale}`)
    .join("|");
}

// POST /api/work-os/voice/next-steps
// Body: { intervalId, voice? }
//
// Reads one approved recap's suggested next steps aloud. The body carries an
// id, never text: an organisation's text-to-speech bill must never be a way to
// speak arbitrary strings, and the words that come back are the suggestions'
// own — titles and rationales as they were filed, nothing paraphrased, nothing
// that was not suggested.
//
// The response is the WAV itself, with the spoken lines in a header so the
// client's prompter shows exactly what is being said.
export async function handleNextStepsSpeech(
  request: Request,
  deps: NextStepsSpeechRouteDeps = liveDeps,
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
      | { intervalId?: unknown; voice?: unknown }
      | null;
    const intervalId = typeof body?.intervalId === "string" ? body.intervalId.trim() : "";
    // A malformed id is answered as gone, exactly like an unknown one: the
    // database must never be asked about a string that cannot be an id, and a
    // caller must not learn the difference between "wrong" and "not yours".
    if (!UUID_RE.test(intervalId)) {
      return fail("That recap is no longer available.", 404);
    }
    const requestedVoice = typeof body?.voice === "string" ? body.voice.trim() : "";
    const voice = RECAP_VOICES.includes(requestedVoice as (typeof RECAP_VOICES)[number])
      ? requestedVoice
      : DEFAULT_RECAP_VOICE;

    let view: NextStepsMomentView | null;
    try {
      view = await deps.loadMoment(access, intervalId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // An id that names nothing, or someone else's recap, is answered the same
      // way: there is nothing here to read aloud for this caller.
      if (message === "activity interval not found" || message === "forbidden") {
        return fail("That recap is no longer available.", 404);
      }
      throw error;
    }
    if (!view) return fail("That recap is no longer available.", 404);

    // Only an approved recap has next steps to read. Anything still generating,
    // skipped, failed, or carrying no items has nothing to say aloud.
    if (view.status !== "ready" && view.status !== "done") {
      return fail(recapSpeechFailureCopy("empty"), FAILURE_STATUS.empty);
    }
    if (!view.items.length) {
      return fail(recapSpeechFailureCopy("empty"), FAILURE_STATUS.empty);
    }

    let lines: RecapSpeechLine[];
    try {
      lines = buildNextStepsSpeechLines({ label: view.label, items: view.items });
    } catch {
      return fail(recapSpeechFailureCopy("too_long"), FAILURE_STATUS.too_long);
    }

    const signature = suggestionSignature(view.items);
    const result = await deps.speak({ intervalId, signature, voice, lines });
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
        "x-work-os-next-steps-voice": result.voice,
        "x-work-os-next-steps-lines": encodeURIComponent(JSON.stringify(lines)),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
