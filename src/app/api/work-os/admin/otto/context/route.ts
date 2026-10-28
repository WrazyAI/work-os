import { NextResponse } from "next/server";
import { voiceInputConfigured } from "@/lib/aiTranscribe";
import { recapSpeechConfigured } from "@/lib/work-os-recap-speech";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { initializeAdminOtto } from "@/lib/work-os-admin-otto-preferences";
import { jsonError } from "@/lib/work-os-api";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";
import type { OttoScope } from "@/modules/work-os/admin-otto/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function wireResponse(response: NextResponse) {
  return NextResponse.json({ schemaVersion: 1, ...await response.json() }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminOttoAccess(req);
    if (auth.response) return wireResponse(auth.response);
    // A cookie-authenticated write needs the app origin; native desktop bearer
    // clients keep their existing CORS contract.
    if (!req.headers.get("authorization") && !hasExpectedPublicOrigin(req)) {
      return wireResponse(NextResponse.json({ error: "invalid origin" }, { status: 403 }));
    }
    const { access } = auth;
    // The explicit POST context is the only first-use activation or recovery
    // point; a normal reconnect keeps the existing epoch and watermark.
    await initializeAdminOtto(access);
    const scope: OttoScope = { userId: access.ctx.user.id, organizationId: access.organizationId, mode: "admin" };
    const voiceEnabled = access.featureFlags.voice_input === true;
    return NextResponse.json({
      schemaVersion: 1,
      scope,
      personId: access.personId,
      voiceAvailable: voiceEnabled && recapSpeechConfigured(),
      transcriptionAvailable: voiceEnabled && voiceInputConfigured(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return wireResponse(jsonError(error));
  }
}
