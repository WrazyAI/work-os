import { NextResponse } from "next/server";
import { fetchLoomMetadata, loomMetadataEnabled, loomTemporal, loomUsableForDay, parseLoomReference } from "@/lib/work-os-loom";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { loadShiftData } from "@/lib/work-os-internal";
import { localDateForTimezone } from "@/modules/work-os/companion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Link read-back for the composer: resolves the Loom link the employee
 * pasted into its public title/duration/recording date and the verdict for the
 * day it is being attached to. No analysis runs here. */
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
    const body = await req.json().catch(() => ({})) as { url?: unknown; targetDate?: unknown };
    const reference = parseLoomReference(typeof body.url === "string" ? body.url : "");
    if (!reference) return NextResponse.json({ error: "url must be a Loom share link" }, { status: 400 });
    const { timezone } = await loadShiftData(auth.access, auth.access.personId as string, new Date());
    const targetDate = typeof body.targetDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
      ? body.targetDate
      : localDateForTimezone(new Date(), timezone);
    const metadata = await fetchLoomMetadata(reference);
    const temporal = loomTemporal(metadata?.createdAt ?? null, targetDate, timezone);
    return NextResponse.json({
      videoId: reference.videoId,
      url: reference.url,
      title: metadata?.title ?? null,
      durationSeconds: metadata?.durationSeconds ?? null,
      thumbnailUrl: metadata?.thumbnailUrl ?? null,
      createdAt: metadata?.createdAt ?? null,
      metadataAvailable: metadata !== null,
      temporal,
      usableForDay: loomUsableForDay(temporal),
    });
  } catch (error) {
    return jsonError(error);
  }
}
