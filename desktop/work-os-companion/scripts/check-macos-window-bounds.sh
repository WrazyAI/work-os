#!/usr/bin/env bash
# Only runs in a disposable Mac CI desktop. Tests the actual shipped process,
# not a browser viewport: CSS cannot see the part of a window below the screen.
set -euo pipefail
if [[ "${CI:-}" != true || "$(uname -s)" != Darwin ]]; then
  echo 'Native window geometry checks require a disposable macOS CI runner' >&2
  exit 1
fi
binary="${1:?Pass the packaged app binary}"
probe="${RUNNER_TEMP:?}/native-window-probe"
xcrun swiftc scripts/macos-window-bounds.swift -o "$probe"
if "$probe" --compact-display; then
  :
else
  status=$?
  [[ "$status" == 3 ]] || exit "$status"
  # Hosted Macs may expose only one 1080p display mode. Reserve equivalent
  # native work-area space with the real Dock, on this disposable runner only.
  # No browser viewport or window geometry is mocked.
  defaults write com.apple.dock persistent-apps -array
  defaults write com.apple.dock persistent-others -array
  defaults write com.apple.dock orientation -string bottom
  defaults write com.apple.dock tilesize -int 256
  defaults write com.apple.dock autohide -bool false
  killall Dock || true
  for attempt in {1..20}; do
    if "$probe" --compact-work-area; then break; fi
    sleep 1
  done
  "$probe" --compact-work-area
fi
"$binary" > "$RUNNER_TEMP/native-window-process.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
  if "$probe" "$pid" > "$RUNNER_TEMP/native-window-bounds.json"; then
    cat "$RUNNER_TEMP/native-window-bounds.json"
    screencapture -x "$RUNNER_TEMP/native-window-screen.png" || true
    exit 0
  else
    status=$?
    if [[ "$status" != 2 ]]; then
      cat "$RUNNER_TEMP/native-window-bounds.json"
      screencapture -x "$RUNNER_TEMP/native-window-screen.png" || true
      exit "$status"
    fi
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    cat "$RUNNER_TEMP/native-window-process.log" >&2
    exit 1
  fi
  sleep 1
done
echo 'The main native window did not become observable' >&2
exit 1
