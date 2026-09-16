import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { githubApiHeaders, isGitHubAssetApiUrl, isTrustedManifestHost, selectNewestManifestAsset } from "../src/lib/work-os-desktop-updates";

const asset = (name: string, id: number) => ({ name, url: `https://api.github.com/repos/WrazyAI/work-os/releases/assets/${id}` });

test("the newest published manifest release wins regardless of listing order", () => {
  const selected = selectNewestManifestAsset([
    { tag_name: "work-os-companion-internal-v0.2.95", draft: true, created_at: "2026-09-15T20:20:03Z", assets: [asset("latest-internal.json", 1)] },
    { tag_name: "work-os-companion-internal-v0.3.02", draft: false, published_at: "2026-09-16T12:32:53Z", assets: [asset("latest-internal.json", 2)] },
    { tag_name: "work-os-companion-internal-v0.3.03", draft: false, published_at: "2026-09-16T14:36:56Z", assets: [asset("latest-internal.json", 3)] },
    { tag_name: "work-os-companion-internal-v0.3.0", draft: false, published_at: "2026-09-16T03:57:29Z", assets: [asset("latest-internal.json", 4)] },
  ]);
  assert.deepEqual(selected, { tag: "work-os-companion-internal-v0.3.03", url: "https://api.github.com/repos/WrazyAI/work-os/releases/assets/3" });
});

test("drafts, other tags, and releases without the manifest are ignored", () => {
  assert.equal(selectNewestManifestAsset([]), null);
  assert.equal(selectNewestManifestAsset([
    { tag_name: "work-os-companion-internal-v0.3.03", draft: true, published_at: "2026-09-16T14:36:56Z", assets: [asset("latest-internal.json", 1)] },
    { tag_name: "v1.0.0", draft: false, published_at: "2026-09-16T15:00:00Z", assets: [asset("latest-internal.json", 2)] },
    { tag_name: "work-os-companion-internal-v0.3.02", draft: false, published_at: "2026-09-16T12:32:53Z", assets: [asset("SHA256SUMS.txt", 3)] },
  ]), null);
  assert.deepEqual(selectNewestManifestAsset([
    { tag_name: "work-os-companion-internal-v0.3.01", draft: false, created_at: "2026-09-16T09:55:24Z", assets: [asset("latest-internal.json", 9)] },
  ]), { tag: "work-os-companion-internal-v0.3.01", url: "https://api.github.com/repos/WrazyAI/work-os/releases/assets/9" });
});

test("the release token only travels to GitHub hosts", () => {
  assert.equal(isTrustedManifestHost("https://api.github.com/repos/WrazyAI/work-os/releases/assets/1"), true);
  assert.equal(isTrustedManifestHost("https://github.com/WrazyAI/work-os/releases/download/x/latest-internal.json"), true);
  assert.equal(isTrustedManifestHost("https://objects.githubusercontent.com/abc"), true);
  assert.equal(isTrustedManifestHost("https://evil.example.com/manifest.json"), false);
  assert.equal(isTrustedManifestHost("not a url"), false);
  assert.equal(isGitHubAssetApiUrl("https://api.github.com/repos/WrazyAI/work-os/releases/assets/567934087"), true);
  assert.equal(isGitHubAssetApiUrl("https://api.github.com/repos/WrazyAI/work-os/releases/tags/x"), false);
});

test("the release token is attached only when configured", () => {
  const withToken = githubApiHeaders("secret-token");
  assert.equal(withToken.Authorization, "Bearer secret-token");
  assert.equal(withToken["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal(githubApiHeaders(null).Authorization, undefined);
  assert.equal(githubApiHeaders("   ").Authorization, undefined);
  assert.equal(githubApiHeaders("t", "application/octet-stream").Accept, "application/octet-stream");
});

test("the update route resolves the newest manifest without a configured template", () => {
  const routePath = "src/app/api/work-os/desktop/updates/[target]/[arch]/[version]/route.ts";
  assert.ok(existsSync(routePath), routePath);
  const route = readFileSync(routePath, "utf8");
  assert.match(route, /WORK_OS_DESKTOP_UPDATE_MANIFEST_URL/);
  assert.match(route, /WORK_OS_RELEASE_GITHUB_TOKEN/);
  assert.match(route, /resolveNewestManifest/);
  assert.match(route, /selectNewestManifestAsset/);
  assert.match(route, /application\/octet-stream/);
  assert.match(route, /status: 204/);
});
