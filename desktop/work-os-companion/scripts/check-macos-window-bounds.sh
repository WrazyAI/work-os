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
"$probe" --compact-display
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
