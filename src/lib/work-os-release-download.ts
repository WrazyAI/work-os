import { createHmac, timingSafeEqual } from "node:crypto";

const GITHUB_API = "https://api.github.com";
const REPOSITORY = "WrazyAI/work-os";
const INTERNAL_TAG_PREFIX = "work-os-companion-internal-v";
const DOWNLOAD_GRANT_TTL_SECONDS = 10 * 60;

export const WINDOWS_INSTALLER_ASSET = "Work-OS-Companion-Setup-UNSIGNED.exe";
export const WINDOWS_INSTALLER_SIGNATURE_ASSET = `${WINDOWS_INSTALLER_ASSET}.sig`;
export const WINDOWS_CHECKSUM_ASSET = "SHA256SUMS.txt";
export const MACOS_INSTALLER_ASSET = "Work-OS-Companion-macOS-Universal-UNSIGNED.dmg";
export const MACOS_UPDATER_ASSET = "Work-OS-Companion-macOS-Universal-UNSIGNED.app.tar.gz";
export type InternalReleasePlatform = "windows-x86_64" | "darwin-aarch64" | "darwin-x86_64";
type UpdaterAsset = typeof WINDOWS_INSTALLER_ASSET | typeof MACOS_UPDATER_ASSET;

export function internalReleasePlatform(target: string, arch: string): InternalReleasePlatform | null {
  if (target === "windows" && arch === "x86_64") return "windows-x86_64";
  if (target === "darwin" && (arch === "aarch64" || arch === "x86_64")) return `darwin-${arch}`;
  return null;
}

export function internalReleaseUpdaterAsset(platform: InternalReleasePlatform): UpdaterAsset {
  return platform === "windows-x86_64" ? WINDOWS_INSTALLER_ASSET : MACOS_UPDATER_ASSET;
}

interface GitHubAsset {
  name: string;
  url: string;
  size: number;
  content_type: string;
  digest?: string | null;
}

interface GitHubRelease {
  draft: boolean;
  prerelease: boolean;
  tag_name: string;
  body?: string | null;
  published_at?: string | null;
  assets: GitHubAsset[];
}

interface ParsedSemVer {
  core: [number, number, number];
  prerelease: string[] | null;
}

export interface ReleaseAssetDownload {
  asset: GitHubAsset;
  response: Response;
  tag: string;
}

export interface InternalReleaseUpdate {
  tag: string;
  version: string;
  notes: string;
  publishedAt: string | null;
  signature: string;
}

export class ReleaseDownloadError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 502 | 503,
  ) {
    super(message);
    this.name = "ReleaseDownloadError";
  }
}

/**
 * Release tags carry the two-digit display version (v0.3.03) while SemVer and
 * Tauri require the canonical unpadded form (0.3.3). Compare and publish the
 * canonical version everywhere; only the tag keeps the padded display.
 */
export function canonicalInternalVersion(value: string) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) return value;
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}${match[4] ?? ""}`;
}

function parseSemVer(value: string): ParsedSemVer | null {
  const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? null,
  };
}

function comparePrerelease(candidate: string[] | null, current: string[] | null) {
  if (!candidate && !current) return 0;
  if (!candidate) return 1;
  if (!current) return -1;
  const maxLength = Math.max(candidate.length, current.length);
  for (let index = 0; index < maxLength; index += 1) {
    const candidatePart = candidate[index];
    const currentPart = current[index];
    if (candidatePart === undefined) return -1;
    if (currentPart === undefined) return 1;
    if (candidatePart === currentPart) continue;
    const candidateNumeric = /^\d+$/.test(candidatePart);
    const currentNumeric = /^\d+$/.test(currentPart);
    if (candidateNumeric && currentNumeric) return Number(candidatePart) > Number(currentPart) ? 1 : -1;
    if (candidateNumeric) return -1;
    if (currentNumeric) return 1;
    return candidatePart > currentPart ? 1 : -1;
  }
  return 0;
}

export function compareInternalReleaseVersions(candidate: string, current: string) {
  const candidateParts = parseSemVer(candidate);
  const currentParts = parseSemVer(current);
  if (!candidateParts || !currentParts) return null;
  for (let index = 0; index < candidateParts.core.length; index += 1) {
    if (candidateParts.core[index] !== currentParts.core[index]) {
      return candidateParts.core[index] > currentParts.core[index] ? 1 : -1;
    }
  }
  return comparePrerelease(candidateParts.prerelease, currentParts.prerelease);
}

export function isNewerInternalReleaseVersion(candidate: string, current: string) {
  return compareInternalReleaseVersions(candidate, current) === 1;
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

export function getWorkOsPublicRequestOrigin(
  requestUrl: string,
  headers: Headers,
  configuredOrigin = process.env.WORK_OS_PUBLIC_APP_URL,
) {
  if (configuredOrigin?.trim()) {
    const origin = new URL(configuredOrigin.trim());
    if (origin.protocol !== "https:" && origin.protocol !== "http:") {
      throw new ReleaseDownloadError("The public Work OS application URL is invalid.", 503);
    }
    return origin.origin;
  }

  const fallback = new URL(requestUrl);
  const host = firstForwardedValue(headers.get("x-forwarded-host"));
  const protocol = firstForwardedValue(headers.get("x-forwarded-proto"));
  if (!host || (protocol !== "https" && protocol !== "http")) return fallback.origin;
  return new URL(`${protocol}://${host}`).origin;
}

function githubHeaders(token: string, accept: string): HeadersInit {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "User-Agent": "Agent-OS-Work-OS-Download-Proxy",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function downloadGrantSignature(version: string, expiresAt: number, token: string, platform: InternalReleasePlatform) {
  // Keep existing Windows grants valid; Mac grants bind the platform too.
  const scope = platform === "windows-x86_64" ? `${version}.${expiresAt}` : `${platform}.${version}.${expiresAt}`;
  return createHmac("sha256", token).update(scope).digest("base64url");
}

export function createInternalReleaseDownloadGrant(
  version: string,
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  now = Date.now(),
  platform: InternalReleasePlatform = "windows-x86_64",
) {
  if (!token?.trim()) {
    throw new ReleaseDownloadError("The release download service is not configured.", 503);
  }
  const expiresAt = Math.floor(now / 1000) + DOWNLOAD_GRANT_TTL_SECONDS;
  return `${expiresAt}.${downloadGrantSignature(version, expiresAt, token, platform)}`;
}

export function verifyInternalReleaseDownloadGrant(
  version: string,
  grant: string | null,
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  now = Date.now(),
  platform: InternalReleasePlatform = "windows-x86_64",
) {
  if (!token?.trim() || !grant) return false;
  const [expiresAtRaw, signature, extra] = grant.split(".");
  if (extra || !/^\d+$/.test(expiresAtRaw) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const expected = Buffer.from(downloadGrantSignature(version, expiresAt, token, platform));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function listApprovedInternalReleases(
  token: string | undefined,
  fetchImpl: typeof fetch,
): Promise<GitHubRelease[]> {
  if (!token?.trim()) {
    throw new ReleaseDownloadError("The release download service is not configured.", 503);
  }

  const releasesResponse = await fetchImpl(
    `${GITHUB_API}/repos/${REPOSITORY}/releases?per_page=100`,
    {
      cache: "no-store",
      headers: githubHeaders(token, "application/vnd.github+json"),
    },
  );
  if (!releasesResponse.ok) {
    throw new ReleaseDownloadError("The release catalog is temporarily unavailable.", 502);
  }

  const releases = (await releasesResponse.json()) as GitHubRelease[];
  if (!Array.isArray(releases)) {
    throw new ReleaseDownloadError("The release catalog returned an invalid response.", 502);
  }
  return releases.filter(
    (candidate) =>
      !candidate.draft &&
      candidate.prerelease &&
      candidate.tag_name.startsWith(INTERNAL_TAG_PREFIX),
  );
}

function findRelease(
  releases: GitHubRelease[],
  version?: string,
): GitHubRelease {
  const release = version
    ? releases.find((candidate) => canonicalInternalVersion(candidate.tag_name.slice(INTERNAL_TAG_PREFIX.length)) === canonicalInternalVersion(version))
    : releases
      .map((candidate) => ({
        candidate,
        version: candidate.tag_name.slice(INTERNAL_TAG_PREFIX.length),
      }))
      .filter(({ version: candidateVersion }) => parseSemVer(candidateVersion) !== null)
      .sort((left, right) => compareInternalReleaseVersions(right.version, left.version) ?? 0)[0]?.candidate;
  if (!release) {
    throw new ReleaseDownloadError("No approved internal Companion release is available.", 404);
  }
  return release;
}

function findAsset(release: GitHubRelease, assetName: string): GitHubAsset {
  const matchingAssets = release.assets.filter((asset) => asset.name === assetName);
  if (matchingAssets.length !== 1) {
    throw new ReleaseDownloadError("The approved release does not contain one unambiguous download asset.", 404);
  }
  return matchingAssets[0];
}

async function downloadAsset(
  asset: GitHubAsset,
  tag: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<ReleaseAssetDownload> {
  const assetResponse = await fetchImpl(asset.url, {
    cache: "no-store",
    redirect: "follow",
    headers: githubHeaders(token, "application/octet-stream"),
  });
  if (!assetResponse.ok || !assetResponse.body) {
    throw new ReleaseDownloadError("The approved release asset could not be downloaded.", 502);
  }
  return { asset, response: assetResponse, tag };
}

export async function downloadLatestInternalAsset(
  assetName: typeof WINDOWS_INSTALLER_ASSET | typeof WINDOWS_CHECKSUM_ASSET | typeof MACOS_INSTALLER_ASSET,
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseAssetDownload> {
  const releases = await listApprovedInternalReleases(token, fetchImpl);
  const release = findRelease(releases);
  return downloadAsset(findAsset(release, assetName), release.tag_name, token!, fetchImpl);
}

export async function downloadInternalReleaseAsset(
  version: string,
  assetName: UpdaterAsset,
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseAssetDownload> {
  const releases = await listApprovedInternalReleases(token, fetchImpl);
  const release = findRelease(releases, version);
  return downloadAsset(findAsset(release, assetName), release.tag_name, token!, fetchImpl);
}

export async function getLatestInternalReleaseUpdate(
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  fetchImpl: typeof fetch = fetch,
  platform: InternalReleasePlatform = "windows-x86_64",
): Promise<InternalReleaseUpdate> {
  const releases = await listApprovedInternalReleases(token, fetchImpl);
  const release = findRelease(releases);
  findAsset(release, internalReleaseUpdaterAsset(platform));
  const signatureDownload = await downloadAsset(
    findAsset(release, `${internalReleaseUpdaterAsset(platform)}.sig`),
    release.tag_name,
    token!,
    fetchImpl,
  );
  const signature = (await signatureDownload.response.text()).trim();
  if (!signature) {
    throw new ReleaseDownloadError("The approved release has an empty updater signature.", 404);
  }
  return {
    tag: release.tag_name,
    version: canonicalInternalVersion(release.tag_name.slice(INTERNAL_TAG_PREFIX.length)),
    notes: release.body?.trim() || `UNSIGNED INTERNAL Work OS Companion ${release.tag_name.slice(INTERNAL_TAG_PREFIX.length)}.`,
    publishedAt: release.published_at ?? null,
    signature,
  };
}

export function releaseDownloadResponse(download: ReleaseAssetDownload): Response {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="${download.asset.name}"`,
    "Content-Type": download.asset.content_type || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "X-Work-OS-Release": download.tag,
  });
  const contentLength = download.response.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);
  if (download.asset.digest?.startsWith("sha256:")) {
    headers.set("X-Checksum-SHA256", download.asset.digest.slice("sha256:".length));
  }
  if (download.asset.name === WINDOWS_INSTALLER_ASSET) {
    headers.set("X-Work-OS-Authenticode", "unsigned-internal");
  }
  return new Response(download.response.body, { status: 200, headers });
}
