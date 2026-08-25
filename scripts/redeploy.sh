#!/usr/bin/env bash
# Atomic redeploy: build into a separate directory, then swap it into place
# before restarting the prod web service. The live server must never see a
# half-written build tree, which otherwise produces HTML with missing CSS/JS.
set -euo pipefail
cd /home/dev/agent-os

SERVICE="agentos-web.service"
LIVE_DIST=".next"
STAGING_DIST=".next.staging"
PREVIOUS_DIST=".next.previous"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# Multiple long-lived operator sessions can request a deploy at once. Keep the
# shared staging directory single-writer so one build cannot delete another
# build's temporary manifest midway through Turbopack output.
REDEPLOY_LOCK="/tmp/agentos-redeploy.lock"
exec 9>"$REDEPLOY_LOCK"
flock 9

rm -rf "$STAGING_DIST"
cleanup_staging() {
  rm -rf "$STAGING_DIST"
}
trap cleanup_staging EXIT

echo "▶ building…"
# Next 16 defaults to Turbopack for production builds.  Turbopack currently
# has a race in this app's large route graph where it removes the hashed
# static directory while writing _buildManifest.js, leaving a partial staging
# tree and aborting the deploy.  Use the stable webpack builder for the
# production artifact; the swap below remains atomic either way.
NEXT_DIST_DIR="$STAGING_DIST" npm run build -- --webpack

echo "▶ swapping build…"
systemctl --user stop "$SERVICE"
rm -rf "$PREVIOUS_DIST"
if [ -d "$LIVE_DIST" ]; then
  mv "$LIVE_DIST" "$PREVIOUS_DIST"
fi
mv "$STAGING_DIST" "$LIVE_DIST"

echo "▶ restarting agentos-web…"
systemctl --user start "$SERVICE"

sleep 4
if ! systemctl --user is-active --quiet "$SERVICE"; then
  echo "✗ web service failed to start; restoring previous build" >&2
  systemctl --user stop "$SERVICE" || true
  rm -rf "$LIVE_DIST"
  mv "$PREVIOUS_DIST" "$LIVE_DIST"
  systemctl --user start "$SERVICE"
  exit 1
fi

check_live_assets() {
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/login >/dev/null || return 1
  node -e '
    (async () => {
      const response = await fetch("http://127.0.0.1:3000/login");
      const html = await response.text();
      const css = [...html.matchAll(/href="([^"]+\.css)"/g)].map((match) => match[1]);
      if (!css.length) throw new Error("login HTML contains no CSS links");
      for (const href of css) {
        const asset = await fetch(new URL(href, "http://127.0.0.1:3000"));
        if (!asset.ok || !(asset.headers.get("content-type") || "").includes("text/css")) {
          throw new Error(`CSS asset failed: ${href} (${asset.status})`);
        }
      }
    })().catch((error) => { console.error(error.message); process.exit(1); });
  '
}

if ! check_live_assets; then
  echo "✗ web health check failed; restoring previous build" >&2
  systemctl --user stop "$SERVICE" || true
  rm -rf "$LIVE_DIST"
  mv "$PREVIOUS_DIST" "$LIVE_DIST"
  systemctl --user start "$SERVICE"
  exit 1
fi

rm -rf "$PREVIOUS_DIST"
echo "✓ redeployed build"
systemctl --user is-active "$SERVICE" agentos-runner.service
