import { NextResponse } from "next/server";
import { analyzeLoomForAgent } from "@/lib/aiLoom";
import { loomMetadataEnabled } from "@/lib/work-os-loom";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { loadShiftData } from "@/lib/work-os-internal";
import { localDateForTimezone } from "@/modules/work-os/companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The agent tool: analyzes one Loom recording and returns the recording's
 * metadata, day verdict, and suggested follow-up work. Nothing is filed here —
 * the calling agent decides what to propose. */
export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    if (!loomMetadataEnabled(auth.access.featureFlags)) {
      return NextResponse.json({ error: "Loom analysis is disabled for this organization" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({})) as { url?: unknown; transcript?: unknown; targetDate?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    const { timezone } = await loadShiftData(auth.access, auth.access.personId as string, new Date());
    const targetDate = typeof body.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
      ? body.targetDate
      : localDateForTimezone(new Date(), timezone);
    const feed = await analyzeLoomForAgent({
      url: body.url.trim(),
      transcript: typeof body.transcript === "string" ? body.transcript : null,
      targetDate,
      timezone,
    });
    if (!feed.bundle) return NextResponse.json({ error: "url must be a Loom share link" }, { status: 400 });
    return NextResponse.json({
      reference: feed.bundle.reference,
      metadata: feed.bundle.metadata,
      temporal: feed.bundle.temporal,
      transcript: {
        present: feed.bundle.transcript.present,
        chars: feed.bundle.transcript.chars,
        source: feed.bundle.transcript.source,
      },
      analysis: feed.analysis,
      blocked: feed.blocked,
      reason: feed.reason,
    });
  } catch (error) {
    return jsonError(error);
  }
}
