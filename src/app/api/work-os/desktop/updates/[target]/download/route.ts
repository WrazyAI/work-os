import { NextResponse } from "next/server";
import { requireWorkOsAccess } from "@/lib/work-os-api";
import {
  downloadInternalReleaseAsset,
  releaseDownloadResponse,
  ReleaseDownloadError,
  verifyInternalReleaseDownloadGrant,
  WINDOWS_INSTALLER_ASSET,
} from "@/lib/work-os-release-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ target: string }> }) {
  try {
    const { target: version } = await params;
    const authorization = req.headers.get("authorization");
    if (authorization) {
      const auth = await requireWorkOsAccess({
        authorization,
        organizationId: req.headers.get("x-work-os-organization-id"),
        feature: "desktop_companion",
      });
      if (auth.response) return auth.response;
    } else if (!verifyInternalReleaseDownloadGrant(version, new URL(req.url).searchParams.get("grant"))) {
      return NextResponse.json({ error: "A valid Work OS update grant is required." }, {
        status: 401,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return releaseDownloadResponse(
      await downloadInternalReleaseAsset(version, WINDOWS_INSTALLER_ASSET),
    );
  } catch (error) {
    const status = error instanceof ReleaseDownloadError ? error.status : 502;
    const message = error instanceof ReleaseDownloadError
      ? error.message
      : "The Windows update is temporarily unavailable.";
    return NextResponse.json({ error: message }, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
