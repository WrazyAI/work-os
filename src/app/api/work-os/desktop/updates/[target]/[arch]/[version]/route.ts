import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import {
  createInternalReleaseDownloadGrant,
  getLatestInternalReleaseUpdate,
  getWorkOsPublicRequestOrigin,
  isNewerInternalReleaseVersion,
  internalReleasePlatform,
  ReleaseDownloadError,
} from "@/lib/work-os-release-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noUpdate() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request, { params }: { params: Promise<{ target: string; arch: string; version: string }> }) {
  try {
    const authorization = req.headers.get("authorization");
    const organizationId = req.headers.get("x-work-os-organization-id");
    if (!authorization || !organizationId) {
      return NextResponse.json(
        { error: "desktop session and organization headers are required" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const auth = await requireWorkOsAccess({
      authorization,
      organizationId,
      feature: "desktop_companion",
    });
    if (auth.response) return auth.response;
    const values = await params;
    const platform = internalReleasePlatform(values.target, values.arch);
    if (!platform) return noUpdate();
    const update = await getLatestInternalReleaseUpdate(undefined, undefined, platform);
    if (!isNewerInternalReleaseVersion(update.version, values.version)) return noUpdate();
    const downloadUrl = new URL(
      `/api/work-os/desktop/updates/${encodeURIComponent(update.version)}/download`,
      getWorkOsPublicRequestOrigin(req.url, req.headers),
    );
    downloadUrl.searchParams.set("platform", platform);
    downloadUrl.searchParams.set("grant", createInternalReleaseDownloadGrant(update.version, undefined, undefined, platform));
    return NextResponse.json({
      version: update.version,
      notes: update.notes,
      pub_date: update.publishedAt,
      url: downloadUrl.toString(),
      signature: update.signature,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ReleaseDownloadError) {
      // Tauri treats an error JSON body as a malformed update manifest. Until an
      // internal prerelease is published, the correct updater protocol is 204.
      if (error.status === 404) return noUpdate();
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return jsonError(error);
  }
}
