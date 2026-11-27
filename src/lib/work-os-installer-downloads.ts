import {
  downloadLatestInternalAsset,
  releaseDownloadResponse,
  ReleaseDownloadError,
  type ReleaseChannel,
} from "./work-os-release-download";
import {
  publicChecksumAsset,
  publicInstallerAsset,
  publicInstallerPlatform,
  type PublicInstallerPlatform,
} from "./work-os-installers";

/** Server-only public delivery. The browser never receives the release token or
 * a GitHub URL, and only the two published installer assets are selectable. */
export async function downloadPublicInstaller(
  platform: PublicInstallerPlatform,
  channel: ReleaseChannel = "stable",
): Promise<Response> {
  const asset = publicInstallerAsset(platform);
  const download = await downloadLatestInternalAsset(asset, undefined, undefined, channel, asset);
  const response = releaseDownloadResponse(download);
  response.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
  response.headers.set("X-Work-OS-Channel", channel);
  return response;
}

export async function downloadPublicChecksums(
  rawPlatform: string,
  channel: ReleaseChannel = "stable",
): Promise<Response | null> {
  const platform = publicInstallerPlatform(rawPlatform);
  if (platform === null) return null;
  const download = await downloadLatestInternalAsset(
    publicChecksumAsset(),
    undefined,
    undefined,
    channel,
    publicInstallerAsset(platform),
  );
  const response = releaseDownloadResponse(download);
  response.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
  response.headers.set("X-Work-OS-Channel", channel);
  return response;
}

export function installerError(error: unknown): Response {
  const status = error instanceof ReleaseDownloadError ? error.status : 502;
  const message = error instanceof ReleaseDownloadError ? error.message : "The installer is temporarily unavailable.";
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
