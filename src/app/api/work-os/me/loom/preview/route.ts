import { NextResponse } from "next/server";
import { fetchLoomMetadata, loomMetadataEnabled, parseLoomReference } from "@/lib/work-os-loom";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Link read-back for the composer: resolves the Loom link the employee
 * pasted into its public title/duration/thumbnail before they attach it. */
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
      return NextResponse.json({ error: "Loom updates are disabled for this organization" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({})) as { url?: unknown };
    const reference = parseLoomReference(typeof body.url === "string" ? body.url : "");
    if (!reference) return NextResponse.json({ error: "url must be a Loom share link" }, { status: 400 });
    const metadata = await fetchLoomMetadata(reference);
    return NextResponse.json({
      videoId: reference.videoId,
      url: reference.url,
      title: metadata?.title ?? null,
      durationSeconds: metadata?.durationSeconds ?? null,
      thumbnailUrl: metadata?.thumbnailUrl ?? null,
      metadataAvailable: metadata !== null,
    });
  } catch (error) {
    return jsonError(error);
  }
}
