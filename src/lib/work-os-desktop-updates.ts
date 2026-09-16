/** Desktop companion update catalog.
 *
 * The GitHub repository is private, so the update manifest can only be read
 * with a release token. Releases are per-version, so the newest release that
 * carries `latest-internal.json` is resolved by timestamp instead of trusting
 * the API listing order (drafts and old releases interleave in it).
 */

export const DESKTOP_RELEASE_TAG_PREFIX = "work-os-companion-internal-v";
export const DESKTOP_RELEASE_MANIFEST_ASSET = "latest-internal.json";

export interface GitHubReleaseLike {
  tag_name?: unknown;
  draft?: unknown;
  published_at?: unknown;
  created_at?: unknown;
  assets?: Array<{ name?: unknown; url?: unknown }>;
}

export interface DesktopManifestAsset {
  tag: string;
  url: string;
}

function releaseTimestamp(release: GitHubReleaseLike) {
  const parsed = Date.parse(String(release.published_at ?? release.created_at ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Picks the newest published release whose tag carries the desktop manifest. */
export function selectNewestManifestAsset(releases: GitHubReleaseLike[], options: { prefix?: string; asset?: string } = {}): DesktopManifestAsset | null {
  const prefix = options.prefix ?? DESKTOP_RELEASE_TAG_PREFIX;
  const assetName = options.asset ?? DESKTOP_RELEASE_MANIFEST_ASSET;
  const candidates = releases.flatMap((release) => {
    if (release.draft === true) return [];
    const tag = String(release.tag_name ?? "");
    if (!tag.startsWith(prefix)) return [];
    const asset = (release.assets ?? []).find((item) => String(item.name ?? "") === assetName);
    const url = String(asset?.url ?? "");
    if (!url) return [];
    return [{ tag, url, at: releaseTimestamp(release) }];
  });
  candidates.sort((left, right) => right.at - left.at || right.tag.localeCompare(left.tag));
  return candidates[0] ? { tag: candidates[0].tag, url: candidates[0].url } : null;
}

export function githubApiHeaders(token?: string | null, accept = "application/vnd.github+json"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "work-os-desktop-updater",
  };
  const value = token?.trim();
  if (value) headers.Authorization = `Bearer ${value}`;
  return headers;
}

/** Release API asset responses stream bytes only with the octet-stream accept. */
export function isGitHubAssetApiUrl(url: string) {
  return /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+$/.test(url);
}

/** Only GitHub hosts may receive the release token. */
export function isTrustedManifestHost(url: string) {
  try {
    const host = new URL(url).host;
    return host === "github.com" || host === "api.github.com" || host.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
}
