#!/usr/bin/env bash
set -euo pipefail
binary="src-tauri/target/universal-apple-darwin/release/bundle/macos/Work OS Companion.app/Contents/MacOS/work-os-companion"
log="${RUNNER_TEMP:?}/companion-startup.log"
"$binary" > "$log" 2>&1 &
companion_pid=$!
trap 'kill "$companion_pid" 2>/dev/null || true; wait "$companion_pid" 2>/dev/null || true' EXIT
sleep 8
if ! kill -0 "$companion_pid" 2>/dev/null; then
  cat "$log"
  exit 1
fi
