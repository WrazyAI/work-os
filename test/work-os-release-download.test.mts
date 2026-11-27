import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalInternalVersion,
  downloadLatestInternalAsset,
  downloadInternalReleaseAsset,
  createInternalReleaseDownloadGrant,
  getLatestInternalReleaseUpdate,
  getWorkOsPublicRequestOrigin,
  isNewerInternalReleaseVersion,
  releaseDownloadResponse,
  ReleaseDownloadError,
  verifyInternalReleaseDownloadGrant,
  WINDOWS_CHECKSUM_ASSET,
  WINDOWS_INSTALLER_ASSET,
  WINDOWS_INSTALLER_SIGNATURE_ASSET,
  MACOS_UPDATER_ASSET,
  NIGHTLY_MACOS_UPDATER_ASSET,
  NIGHTLY_WINDOWS_INSTALLER_ASSET,
  NIGHTLY_WINDOWS_INSTALLER_SIGNATURE_ASSET,
  internalReleasePlatform,
  internalReleaseUpdaterAsset,
  normalizeReleaseChannel,
} from "../src/lib/work-os-release-download";
import { releaseAssetNames } from "../desktop/work-os-companion/scripts/macos-release.mjs";

const release = {
  draft: false,
  prerelease: true,
  tag_name: "work-os-companion-internal-v0.2.2",
  assets: [
    {
      name: WINDOWS_INSTALLER_ASSET,
      url: "https://api.github.test/assets/1",
      size: 4,
      content_type: "application/octet-stream",
      digest: `sha256:${"a".repeat(64)}`,
    },
    {
      name: WINDOWS_CHECKSUM_ASSET,
      url: "https://api.github.test/assets/2",
      size: 9,
      content_type: "text/plain",
    },
    {
      name: WINDOWS_INSTALLER_SIGNATURE_ASSET,
      url: "https://api.github.test/assets/3",
      size: 8,
      content_type: "application/octet-stream",
    },
  ],
};

const repositoryRoot = resolve(import.meta.dirname, "..");
assert.equal(
  existsSync(resolve(repositoryRoot, "src/app/api/work-os/desktop/updates/[target]/download/route.ts")),
  true,
);

assert.equal(
  getWorkOsPublicRequestOrigin(
    "https://localhost:3000/api/work-os/desktop/updates/windows/x86_64/0.2.2",
    new Headers({ "x-forwarded-host": "srv1726015.tailbf7608.ts.net", "x-forwarded-proto": "https" }),
    "",
  ),
  "https://srv1726015.tailbf7608.ts.net",
);
assert.equal(
  getWorkOsPublicRequestOrigin(
    "http://127.0.0.1:3000/api/work-os/desktop/updates/windows/x86_64/0.2.2",
    new Headers(),
    "https://work-os.example.test/some/path",
  ),
  "https://work-os.example.test",
);
assert.equal(
  existsSync(resolve(repositoryRoot, "src/app/api/work-os/desktop/updates/[version]/download/route.ts")),
  false,
);

const requests: Array<{ url: string; authorization: string | null; accept: string | null }> = [];
const mockFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  requests.push({
    url,
    authorization: headers.get("authorization"),
    accept: headers.get("accept"),
  });
  if (url.includes("/releases?")) return Response.json([release]);
  if (url.endsWith("/assets/1")) {
    return new Response("test", { headers: { "content-length": "4" } });
  }
  if (url.endsWith("/assets/3")) return new Response("signature");
  throw new Error(`Unexpected URL: ${url}`);
};

const download = await downloadLatestInternalAsset(WINDOWS_INSTALLER_ASSET, "secret-token", mockFetch);
const response = releaseDownloadResponse(download);
assert.equal(await response.text(), "test");
assert.equal(response.headers.get("content-disposition"), `attachment; filename="${WINDOWS_INSTALLER_ASSET}"`);
assert.equal(response.headers.get("x-work-os-authenticode"), "unsigned-internal");
assert.equal(response.headers.get("x-checksum-sha256"), "a".repeat(64));
assert.equal(response.headers.get("cache-control"), "private, no-store");
assert.equal(requests.length, 2);
assert.ok(requests.every((request) => request.authorization === "Bearer secret-token"));
assert.equal(requests[1].accept, "application/octet-stream");

const update = await getLatestInternalReleaseUpdate("secret-token", mockFetch);
assert.deepEqual(update, {
  tag: "work-os-companion-internal-v0.2.2",
  version: "0.2.2",
  notes: "UNSIGNED INTERNAL Work OS Companion 0.2.2.",
  publishedAt: null,
  signature: "signature",
});

assert.equal(isNewerInternalReleaseVersion("0.2.12", "0.2.11"), true);
assert.equal(isNewerInternalReleaseVersion("0.2.11", "0.2.12"), false);
assert.equal(isNewerInternalReleaseVersion("0.2.12", "0.2.12"), false);

// Two-digit display tags (v0.3.03) must compare and publish as canonical 0.3.3.
assert.equal(canonicalInternalVersion("0.3.03"), "0.3.3");
assert.equal(canonicalInternalVersion("0.3.2"), "0.3.2");
assert.equal(canonicalInternalVersion("1.10.07"), "1.10.7");
assert.equal(canonicalInternalVersion("0.3.3-rc.1"), "0.3.3-rc.1");
assert.equal(isNewerInternalReleaseVersion("0.3.03", "0.3.2"), true);
assert.equal(isNewerInternalReleaseVersion("0.3.02", "0.3.2"), false);
assert.equal(isNewerInternalReleaseVersion("0.3.2", "0.3.03"), false);

const outOfOrderReleaseFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("/releases?")) return Response.json([
    { ...release, tag_name: "work-os-companion-internal-v0.2.9" },
    { ...release, tag_name: "work-os-companion-internal-v0.2.12" },
    { ...release, tag_name: "work-os-companion-internal-v0.2.11" },
  ]);
  if (url.endsWith("/assets/3")) return new Response("signature");
  throw new Error(`Unexpected URL: ${url}`);
};
const newestOutOfOrderUpdate = await getLatestInternalReleaseUpdate("secret-token", outOfOrderReleaseFetch);
assert.equal(newestOutOfOrderUpdate.version, "0.2.12");

const versionedDownload = await downloadInternalReleaseAsset("0.2.2", WINDOWS_INSTALLER_ASSET, "secret-token", mockFetch);
assert.equal(await versionedDownload.response.text(), "test");

const grant = createInternalReleaseDownloadGrant("0.2.2", "secret-token", 1_000_000);
assert.ok(verifyInternalReleaseDownloadGrant("0.2.2", grant, "secret-token", 1_000_001));
assert.equal(verifyInternalReleaseDownloadGrant("0.2.3", grant, "secret-token", 1_000_001), false);
assert.equal(verifyInternalReleaseDownloadGrant("0.2.2", grant, "secret-token", 1_601_000), false);

await assert.rejects(
  downloadLatestInternalAsset(WINDOWS_INSTALLER_ASSET, "", mockFetch),
  (error: unknown) => error instanceof ReleaseDownloadError && error.status === 503,
);

const unsafeReleaseFetch: typeof fetch = async () => Response.json([
  { ...release, draft: true },
  { ...release, prerelease: false, tag_name: "work-os-companion-v0.2.2" },
]);
await assert.rejects(
  downloadLatestInternalAsset(WINDOWS_INSTALLER_ASSET, "secret-token", unsafeReleaseFetch),
  (error: unknown) => error instanceof ReleaseDownloadError && error.status === 404,
);

const ambiguousAssetFetch: typeof fetch = async () => Response.json([
  { ...release, assets: [release.assets[0], release.assets[0]] },
]);
await assert.rejects(
  downloadLatestInternalAsset(WINDOWS_INSTALLER_ASSET, "secret-token", ambiguousAssetFetch),
  (error: unknown) => error instanceof ReleaseDownloadError && error.status === 404,
);

console.log("Work OS release download proxy tests passed.");

assert.equal(internalReleasePlatform("darwin", "aarch64"), "darwin-aarch64");
assert.equal(internalReleasePlatform("darwin", "x86_64"), "darwin-x86_64");
assert.equal(internalReleasePlatform("windows", "x86_64"), "windows-x86_64");
assert.equal(internalReleasePlatform("darwin", "arm"), null);
assert.equal(internalReleasePlatform("linux", "x86_64"), null);
const macRelease = { ...release, assets: [
  { ...release.assets[0], name: MACOS_UPDATER_ASSET, url: "https://api.github.test/assets/mac" },
  { ...release.assets[2], name: `${MACOS_UPDATER_ASSET}.sig`, url: "https://api.github.test/assets/mac-sig" },
] };
const macFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("/releases?")) return Response.json([macRelease]);
  if (url.endsWith("/mac-sig")) return new Response("mac-signature");
  if (url.endsWith("/mac")) return new Response("mac-archive");
  throw new Error(`Unexpected URL: ${url}`);
};
for (const platform of ["darwin-aarch64", "darwin-x86_64"] as const) {
  const macUpdate = await getLatestInternalReleaseUpdate("secret-token", macFetch, platform);
  assert.equal(macUpdate.signature, "mac-signature");
  const macDownload = await downloadInternalReleaseAsset("0.2.2", MACOS_UPDATER_ASSET, "secret-token", macFetch);
  assert.equal(await macDownload.response.text(), "mac-archive");
  const macGrant = createInternalReleaseDownloadGrant("0.2.2", "secret-token", 1_000_000, platform);
  assert.equal(verifyInternalReleaseDownloadGrant("0.2.2", macGrant, "secret-token", 1_000_001, platform), true);
  assert.equal(verifyInternalReleaseDownloadGrant("0.2.2", macGrant, "secret-token", 1_000_001), false);
  assert.equal(verifyInternalReleaseDownloadGrant("0.2.2", grant, "secret-token", 1_000_001, platform), false);
}
await assert.rejects(getLatestInternalReleaseUpdate("secret-token", mockFetch, "darwin-aarch64"),
  (error: unknown) => error instanceof ReleaseDownloadError && error.status === 404);

assert.equal(normalizeReleaseChannel("nightly"), "nightly");
assert.equal(normalizeReleaseChannel("NIGHTLY"), "nightly");
assert.equal(normalizeReleaseChannel("stable"), "stable");
assert.equal(normalizeReleaseChannel(null), "stable");
assert.equal(normalizeReleaseChannel("unknown"), "stable");

assert.equal(WINDOWS_INSTALLER_ASSET, releaseAssetNames("stable").windowsInstaller);
assert.equal(MACOS_UPDATER_ASSET, releaseAssetNames("stable").macUpdater);
assert.equal(NIGHTLY_WINDOWS_INSTALLER_ASSET, releaseAssetNames("nightly").windowsInstaller);
assert.equal(NIGHTLY_WINDOWS_INSTALLER_SIGNATURE_ASSET, releaseAssetNames("nightly").windowsInstallerSignature);
assert.equal(NIGHTLY_MACOS_UPDATER_ASSET, releaseAssetNames("nightly").macUpdater);

const stableWithMac = {
  ...release,
  tag_name: "work-os-companion-internal-v0.5.45",
  assets: [
    ...release.assets,
    { name: MACOS_UPDATER_ASSET, url: "https://api.github.test/assets/mac-45", size: 10, content_type: "application/gzip" },
    { name: `${MACOS_UPDATER_ASSET}.sig`, url: "https://api.github.test/assets/mac-45-sig", size: 8, content_type: "text/plain" },
  ],
};
const nightlyWinOnly = {
  ...release,
  tag_name: "work-os-companion-nightly-v0.5.46",
  assets: release.assets.map((asset) => {
    if (asset.name === WINDOWS_INSTALLER_ASSET) {
      return { ...asset, name: NIGHTLY_WINDOWS_INSTALLER_ASSET, url: `${asset.url}-nightly` };
    }
    if (asset.name === WINDOWS_INSTALLER_SIGNATURE_ASSET) {
      return { ...asset, name: NIGHTLY_WINDOWS_INSTALLER_SIGNATURE_ASSET, url: `${asset.url}-nightly` };
    }
    return { ...asset, url: `${asset.url}-nightly` };
  }),
};
const dualChannelFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("/releases?")) return Response.json([nightlyWinOnly, stableWithMac]);
  if (url.endsWith("/assets/3")) return new Response("stable-win-sig");
  if (url.endsWith("/assets/3-nightly")) return new Response("nightly-win-sig");
  if (url.endsWith("/assets/mac-45-sig")) return new Response("stable-mac-sig");
  if (url.endsWith("/assets/mac-45")) return new Response("stable-mac-archive");
  throw new Error(`Unexpected URL: ${url}`);
};

const stableWin = await getLatestInternalReleaseUpdate("secret-token", dualChannelFetch, "windows-x86_64", "stable");
assert.equal(stableWin.version, "0.5.45");
assert.equal(stableWin.tag, "work-os-companion-internal-v0.5.45");

const nightlyWin = await getLatestInternalReleaseUpdate("secret-token", dualChannelFetch, "windows-x86_64", "nightly");
assert.equal(nightlyWin.version, "0.5.46");
assert.equal(nightlyWin.tag, "work-os-companion-nightly-v0.5.46");
assert.equal(nightlyWin.signature, "nightly-win-sig");
assert.equal(internalReleaseUpdaterAsset("windows-x86_64", "nightly"), NIGHTLY_WINDOWS_INSTALLER_ASSET);
assert.equal(internalReleaseUpdaterAsset("windows-x86_64", "stable"), WINDOWS_INSTALLER_ASSET);

// A pre-rename Nightly with the channel-neutral Windows names still resolves
// for Nightly clients during the transition.
const legacyNightly = { ...release, tag_name: "work-os-companion-nightly-v0.5.44" };
const legacyNightlyFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("/releases?")) return Response.json([legacyNightly]);
  if (url.endsWith("/assets/1")) return new Response("legacy-win");
  if (url.endsWith("/assets/3")) return new Response("legacy-win-sig");
  throw new Error(`Unexpected URL: ${url}`);
};
const legacyUpdate = await getLatestInternalReleaseUpdate("secret-token", legacyNightlyFetch, "windows-x86_64", "nightly");
assert.equal(legacyUpdate.version, "0.5.44");
assert.equal(legacyUpdate.signature, "legacy-win-sig");
const legacyNightlyDownload = await downloadLatestInternalAsset(
  NIGHTLY_WINDOWS_INSTALLER_ASSET,
  "secret-token",
  legacyNightlyFetch,
  "nightly",
  NIGHTLY_WINDOWS_INSTALLER_ASSET,
);
assert.equal(await legacyNightlyDownload.response.text(), "legacy-win");
const legacyVersionedDownload = await downloadInternalReleaseAsset(
  "0.5.44",
  NIGHTLY_WINDOWS_INSTALLER_ASSET,
  "secret-token",
  legacyNightlyFetch,
  "nightly",
);
assert.equal(legacyVersionedDownload.asset.name, WINDOWS_INSTALLER_ASSET);
assert.equal(await legacyVersionedDownload.response.text(), "legacy-win");

// A publication retry can briefly leave both names on one release. The exact
// Nightly name wins over the legacy alias.
const dualNameNightly = {
  ...release,
  tag_name: "work-os-companion-nightly-v0.5.43",
  assets: [
    ...release.assets,
    { ...release.assets[0], name: NIGHTLY_WINDOWS_INSTALLER_ASSET, url: "https://api.github.test/assets/1-new" },
    { ...release.assets[2], name: NIGHTLY_WINDOWS_INSTALLER_SIGNATURE_ASSET, url: "https://api.github.test/assets/3-new" },
  ],
};
const dualNameFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("/releases?")) return Response.json([dualNameNightly]);
  if (url.endsWith("/assets/1-new")) return new Response("nightly-new-win");
  if (url.endsWith("/assets/3-new")) return new Response("nightly-new-sig");
  throw new Error(`Unexpected URL: ${url}`);
};
const dualNameUpdate = await getLatestInternalReleaseUpdate("secret-token", dualNameFetch, "windows-x86_64", "nightly");
assert.equal(dualNameUpdate.signature, "nightly-new-sig");
const dualNameDownload = await downloadLatestInternalAsset(
  NIGHTLY_WINDOWS_INSTALLER_ASSET,
  "secret-token",
  dualNameFetch,
  "nightly",
  NIGHTLY_WINDOWS_INSTALLER_ASSET,
);
assert.equal(dualNameDownload.asset.name, NIGHTLY_WINDOWS_INSTALLER_ASSET);
assert.equal(await dualNameDownload.response.text(), "nightly-new-win");

// Nightly macOS falls back to the latest release carrying macOS assets when the newest Nightly is Windows-only,
// and downloading that fallback version under channel=nightly succeeds cleanly.
const nightlyMac = await getLatestInternalReleaseUpdate("secret-token", dualChannelFetch, "darwin-aarch64", "nightly");
assert.equal(nightlyMac.version, "0.5.45");
assert.equal(nightlyMac.signature, "stable-mac-sig");
const nightlyMacFallbackDownload = await downloadInternalReleaseAsset("0.5.45", MACOS_UPDATER_ASSET, "secret-token", dualChannelFetch, "nightly");
assert.equal(await nightlyMacFallbackDownload.response.text(), "stable-mac-archive");

// When Nightly 0.5.47 is Windows-only and Nightly 0.5.46 has macOS, macOS Nightly selects 0.5.46 (skipping 0.5.47).
const nightlyMac46 = {
  ...stableWithMac,
  tag_name: "work-os-companion-nightly-v0.5.46",
  assets: [
    ...nightlyWinOnly.assets,
    { name: NIGHTLY_MACOS_UPDATER_ASSET, url: "https://api.github.test/assets/mac-46", size: 10, content_type: "application/gzip" },
    { name: `${NIGHTLY_MACOS_UPDATER_ASSET}.sig`, url: "https://api.github.test/assets/mac-46-sig", size: 8, content_type: "text/plain" },
  ],
};
const nightlyWin47 = { ...nightlyWinOnly, tag_name: "work-os-companion-nightly-v0.5.47" };
const multiNightlyFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("/releases?")) return Response.json([nightlyWin47, nightlyMac46, stableWithMac]);
  if (url.endsWith("/assets/mac-46-sig")) return new Response("nightly-mac-46-sig");
  if (url.endsWith("/assets/mac-46")) return new Response("nightly-mac-46-archive");
  throw new Error(`Unexpected URL: ${url}`);
};
const macNightlyUpdate = await getLatestInternalReleaseUpdate("secret-token", multiNightlyFetch, "darwin-aarch64", "nightly");
assert.equal(macNightlyUpdate.version, "0.5.46");
assert.equal(macNightlyUpdate.tag, "work-os-companion-nightly-v0.5.46");
const macNightlyArchive = await downloadInternalReleaseAsset("0.5.46", NIGHTLY_MACOS_UPDATER_ASSET, "secret-token", multiNightlyFetch, "nightly");
assert.equal(await macNightlyArchive.response.text(), "nightly-mac-46-archive");

const nightlyGrant = createInternalReleaseDownloadGrant("0.5.46", "secret-token", 1_000_000, "windows-x86_64", "nightly");
assert.equal(verifyInternalReleaseDownloadGrant("0.5.46", nightlyGrant, "secret-token", 1_000_001, "windows-x86_64", "nightly"), true);
assert.equal(verifyInternalReleaseDownloadGrant("0.5.46", nightlyGrant, "secret-token", 1_000_001, "windows-x86_64", "stable"), false);
