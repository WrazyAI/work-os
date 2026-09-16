import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { githubApiHeaders, isGitHubAssetApiUrl, isTrustedManifestHost, selectNewestManifestAsset } from "@/lib/work-os-desktop-updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANIFEST_CACHE_MS = 5 * 60_000;
const GITHUB_API = "https://api.github.com";

let manifestCache: { at: number; body: string } | null = null;

function releaseToken() {
  return process.env.WORK_OS_RELEASE_GITHUB_TOKEN?.trim() || null;
}

function releaseRepository() {
  return process.env.WORK_OS_RELEASE_REPOSITORY?.trim() || "WrazyAI/work-os";
}

function manifestHeaders(url: string) {
  if (!isTrustedManifestHost(url)) return undefined;
  return githubApiHeaders(releaseToken(), isGitHubAssetApiUrl(url) ? "application/octet-stream" : "application/vnd.github+json");
}

async function fetchManifest(url: string): Promise<string | null> {
  const upstream = await fetch(url, { cache: "no-store", headers: manifestHeaders(url) });
  if (upstream.status === 204 || upstream.status === 404) return null;
  if (!upstream.ok) throw new Error(`desktop update feed failed (${upstream.status})`);
  const manifest = await upstream.text();
  JSON.parse(manifest);
  return manifest;
}

/** Releases are per-version, so resolve the newest published manifest asset by
 * timestamp. Cached briefly because every companion launch asks for it. */
async function resolveNewestManifest(): Promise<string | null> {
  if (manifestCache && Date.now() - manifestCache.at < MANIFEST_CACHE_MS) return manifestCache.body;
  const listing = await fetch(`${GITHUB_API}/repos/${releaseRepository()}/releases?per_page=30`, {
    cache: "no-store",
    headers: githubApiHeaders(releaseToken()),
  });
  if (!listing.ok) throw new Error(`desktop update catalog failed (${listing.status})`);
  const selected = selectNewestManifestAsset(await listing.json());
  if (!selected) return null;
  const manifest = await fetchManifest(selected.url);
  if (manifest) manifestCache = { at: Date.now(), body: manifest };
  return manifest;
}

export async function GET(req: Request, { params }: { params: Promise<{ target: string; arch: string; version: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      authorization: req.headers.get("authorization"),
      organizationId: req.headers.get("x-work-os-organization-id"),
      feature: "desktop_companion",
    });
    if (auth.response) return auth.response;
    const template = process.env.WORK_OS_DESKTOP_UPDATE_MANIFEST_URL?.trim();
    let manifest: string | null;
    if (template) {
      const values = await params;
      manifest = await fetchManifest(template
        .replaceAll("{{target}}", encodeURIComponent(values.target))
        .replaceAll("{{arch}}", encodeURIComponent(values.arch))
        .replaceAll("{{current_version}}", encodeURIComponent(values.version)));
    } else {
      manifest = await resolveNewestManifest();
    }
    if (!manifest) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    return new NextResponse(manifest, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
