import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MACOS_INSTALLER_ASSET,
  MACOS_UPDATER_ASSET,
  macosUpdaterAsset,
  NIGHTLY_MACOS_INSTALLER_ASSET,
  NIGHTLY_MACOS_UPDATER_ASSET,
  NIGHTLY_WINDOWS_INSTALLER_ASSET,
  NIGHTLY_WINDOWS_INSTALLER_SIGNATURE_ASSET,
  WINDOWS_CHECKSUM_ASSET,
  WINDOWS_INSTALLER_ASSET,
  WINDOWS_INSTALLER_SIGNATURE_ASSET,
  windowsInstallerAsset,
} from "./work-os-installer-assets";

export {
  MACOS_INSTALLER_ASSET,
  MACOS_UPDATER_ASSET,
  NIGHTLY_MACOS_INSTALLER_ASSET,
  NIGHTLY_MACOS_UPDATER_ASSET,
  NIGHTLY_WINDOWS_INSTALLER_ASSET,
  NIGHTLY_WINDOWS_INSTALLER_SIGNATURE_ASSET,
  WINDOWS_CHECKSUM_ASSET,
  WINDOWS_INSTALLER_ASSET,
  WINDOWS_INSTALLER_SIGNATURE_ASSET,
};

const GITHUB_API = "https://api.github.com";
const REPOSITORY = "WrazyAI/work-os";
const INTERNAL_TAG_PREFIX = "work-os-companion-internal-v";
const NIGHTLY_TAG_PREFIX = "work-os-companion-nightly-v";
const DOWNLOAD_GRANT_TTL_SECONDS = 10 * 60;
export type InternalReleasePlatform = "windows-x86_64" | "darwin-aarch64" | "darwin-x86_64";
export type ReleaseChannel = "stable" | "nightly";

export function normalizeReleaseChannel(value: string | null | undefined): ReleaseChannel {
  return value?.trim().toLowerCase() === "nightly" ? "nightly" : "stable";
}

export function internalReleasePlatform(target: string, arch: string): InternalReleasePlatform | null {
  if (target === "windows" && arch === "x86_64") return "windows-x86_64";
  if (target === "darwin" && (arch === "aarch64" || arch === "x86_64")) return `darwin-${arch}`;
  return null;
}

export function internalReleaseUpdaterAsset(
  platform: InternalReleasePlatform,
  channel: ReleaseChannel = "stable",
): string {
  return platform === "windows-x86_64" ? windowsInstallerAsset(channel) : macosUpdaterAsset(channel);
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

function tagChannelAndRawVersion(tag: string): { channel: ReleaseChannel; rawVersion: string } | null {
  if (tag.startsWith(INTERNAL_TAG_PREFIX)) {
    return { channel: "stable", rawVersion: tag.slice(INTERNAL_TAG_PREFIX.length) };
  }
  if (tag.startsWith(NIGHTLY_TAG_PREFIX)) {
    return { channel: "nightly", rawVersion: tag.slice(NIGHTLY_TAG_PREFIX.length) };
  }
  return null;
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

function downloadGrantSignature(
  version: string,
  expiresAt: number,
  token: string,
  platform: InternalReleasePlatform,
  channel: ReleaseChannel = "stable",
) {
  // Keep existing Stable Windows grants valid; bind platform and Nightly channel too.
  const baseScope = platform === "windows-x86_64" ? `${version}.${expiresAt}` : `${platform}.${version}.${expiresAt}`;
  const scope = channel === "nightly" ? `nightly.${baseScope}` : baseScope;
  return createHmac("sha256", token).update(scope).digest("base64url");
}

export function createInternalReleaseDownloadGrant(
  version: string,
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  now = Date.now(),
  platform: InternalReleasePlatform = "windows-x86_64",
  channel: ReleaseChannel = "stable",
) {
  if (!token?.trim()) {
    throw new ReleaseDownloadError("The release download service is not configured.", 503);
  }
  const expiresAt = Math.floor(now / 1000) + DOWNLOAD_GRANT_TTL_SECONDS;
  return `${expiresAt}.${downloadGrantSignature(version, expiresAt, token, platform, channel)}`;
}

export function verifyInternalReleaseDownloadGrant(
  version: string,
  grant: string | null,
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  now = Date.now(),
  platform: InternalReleasePlatform = "windows-x86_64",
  channel: ReleaseChannel = "stable",
) {
  if (!token?.trim() || !grant) return false;
  const [expiresAtRaw, signature, extra] = grant.split(".");
  if (extra || !/^\d+$/.test(expiresAtRaw) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const expected = Buffer.from(downloadGrantSignature(version, expiresAt, token, platform, channel));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function listApprovedInternalReleases(
  token: string | undefined,
  fetchImpl: typeof fetch,
  channel: ReleaseChannel = "stable",
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
  return releases.filter((candidate) => {
    if (candidate.draft || !candidate.prerelease) return false;
    const parsed = tagChannelAndRawVersion(candidate.tag_name);
    if (!parsed) return false;
    return channel === "nightly" ? true : parsed.channel === "stable";
  });
}

function hasSingleAsset(release: GitHubRelease, assetName: string): boolean {
  return release.assets.filter((asset) => asset.name === assetName).length === 1;
}

/** Nightlies published before the channel-specific names used the Stable asset
 * names. Accept that layout so existing installs and pending downloads keep
 * resolving while the rename rolls out. */
function legacyNightlyAssetName(assetName: string): string | null {
  return assetName.startsWith("Work-OS-Companion-Nightly-")
    ? assetName.replace("Work-OS-Companion-Nightly-", "Work-OS-Companion-")
    : null;
}

function assetNameCandidates(assetName: string, channel: ReleaseChannel): string[] {
  const candidates = [assetName];
  if (channel === "nightly") {
    const legacy = legacyNightlyAssetName(assetName);
    if (legacy) candidates.push(legacy);
  }
  return candidates;
}

function findRelease(
  releases: GitHubRelease[],
  version?: string,
  requiredAssetName?: string,
  channel: ReleaseChannel = "stable",
): GitHubRelease {
  const candidates = releases
    .map((candidate) => {
      const parsed = tagChannelAndRawVersion(candidate.tag_name);
      if (!parsed || parseSemVer(parsed.rawVersion) === null) return null;
      return {
        candidate,
        channel: parsed.channel,
        rawVersion: parsed.rawVersion,
        version: canonicalInternalVersion(parsed.rawVersion),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      const order = compareInternalReleaseVersions(right.rawVersion, left.rawVersion) ?? 0;
      if (order !== 0) return order;
      // When the same version exists on both Nightly and Stable, prefer Stable.
      if (left.channel !== right.channel) return left.channel === "stable" ? -1 : 1;
      return 0;
    });

  const release = version
    ? candidates.find((item) => item.version === canonicalInternalVersion(version))?.candidate
    : (requiredAssetName
      ? candidates.find((item) => assetNameCandidates(requiredAssetName, channel).some((name) => hasSingleAsset(item.candidate, name)))?.candidate
      : candidates[0]?.candidate);

  if (!release) {
    throw new ReleaseDownloadError("No approved internal Companion release is available.", 404);
  }
  return release;
}

function findAsset(release: GitHubRelease, assetName: string, channel: ReleaseChannel = "stable"): GitHubAsset {
  const exact = release.assets.filter((asset) => asset.name === assetName);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new ReleaseDownloadError("The approved release does not contain one unambiguous download asset.", 404);
  }
  // A release can briefly carry both names during a publication retry or
  // backfill. Use the legacy Nightly name only when the requested one is absent.
  if (channel === "nightly") {
    const legacy = legacyNightlyAssetName(assetName);
    if (legacy) {
      const legacyMatches = release.assets.filter((asset) => asset.name === legacy);
      if (legacyMatches.length === 1) return legacyMatches[0];
    }
  }
  throw new ReleaseDownloadError("The approved release does not contain one unambiguous download asset.", 404);
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
  assetName: string,
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  fetchImpl: typeof fetch = fetch,
  channel: ReleaseChannel = "stable",
  requiredPlatformAsset?: string,
): Promise<ReleaseAssetDownload> {
  const releases = await listApprovedInternalReleases(token, fetchImpl, channel);
  // For Nightly macOS downloads (or checksums matching a macOS download), pick
  // the newest Nightly/Stable release that actually carries the macOS package.
  const requiredAsset = channel === "nightly"
    ? (requiredPlatformAsset ?? (assetName === WINDOWS_CHECKSUM_ASSET ? undefined : assetName))
    : undefined;
  const release = findRelease(releases, undefined, requiredAsset, channel);
  return downloadAsset(findAsset(release, assetName, channel), release.tag_name, token!, fetchImpl);
}

export async function downloadInternalReleaseAsset(
  version: string,
  assetName: string,
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  fetchImpl: typeof fetch = fetch,
  channel: ReleaseChannel = "stable",
): Promise<ReleaseAssetDownload> {
  const releases = await listApprovedInternalReleases(token, fetchImpl, channel);
  const release = findRelease(releases, version, undefined, channel);
  return downloadAsset(findAsset(release, assetName, channel), release.tag_name, token!, fetchImpl);
}

export async function getLatestInternalReleaseUpdate(
  token = process.env.WORK_OS_RELEASE_GITHUB_TOKEN,
  fetchImpl: typeof fetch = fetch,
  platform: InternalReleasePlatform = "windows-x86_64",
  channel: ReleaseChannel = "stable",
): Promise<InternalReleaseUpdate> {
  const releases = await listApprovedInternalReleases(token, fetchImpl, channel);
  const updaterAsset = internalReleaseUpdaterAsset(platform, channel);
  // Nightly builds are Windows-only unless macOS-specific changes are queued,
  // so macOS Nightly clients look for the newest release that carries macOS.
  const release = findRelease(releases, undefined, channel === "nightly" ? updaterAsset : undefined, channel);
  findAsset(release, updaterAsset, channel);
  const signatureDownload = await downloadAsset(
    findAsset(release, `${updaterAsset}.sig`, channel),
    release.tag_name,
    token!,
    fetchImpl,
  );
  const signature = (await signatureDownload.response.text()).trim();
  if (!signature) {
    throw new ReleaseDownloadError("The approved release has an empty updater signature.", 404);
  }
  const parsedTag = tagChannelAndRawVersion(release.tag_name);
  const rawVersion = parsedTag?.rawVersion ?? release.tag_name;
  return {
    tag: release.tag_name,
    version: canonicalInternalVersion(rawVersion),
    notes: release.body?.trim() || `${parsedTag?.channel === "nightly" ? "NIGHTLY (UNSIGNED)" : "UNSIGNED INTERNAL"} Work OS Companion ${rawVersion}.`,
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
  if (download.asset.name === WINDOWS_INSTALLER_ASSET || download.asset.name === NIGHTLY_WINDOWS_INSTALLER_ASSET) {
    headers.set("X-Work-OS-Authenticode", "unsigned-internal");
  }
  return new Response(download.response.body, { status: 200, headers });
}
