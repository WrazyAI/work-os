#!/usr/bin/env bash
# Packaged Mac startup gate.
#
# Three things are checked against the app the release would ship:
#
#   1. the process survives its first seconds (crash-on-launch),
#   2. the local vault gate SETTLES — the app reaches a boot phase past its
#      loading screen inside the gate timeout, and
#   3. that holds on a device whose saved vault key this build is not trusted
#      for, which is the state an in-place update creates.
#
# Point 2 is the regression this script exists for. The vault key lives in the
# macOS Keychain; an in-place update changes the app's ad-hoc code signature, so
# the saved item no longer matches the new binary and macOS raises a password
# dialog that blocks whoever asked for it. When that ask ran on the app's main
# thread the whole companion froze — the loading screen stayed up forever and the
# mascot could not be dragged — and nothing in the log ever advanced. The phases
# below come from the app's own diagnostics log and only advance while its
# windows are alive, so a stuck launch stops at `boot:loading` and fails here.
set -euo pipefail

root="$(pwd)"
binary="$root/src-tauri/target/universal-apple-darwin/release/bundle/macos/Work OS Companion.app/Contents/MacOS/work-os-companion"
log="${RUNNER_TEMP:?}/companion-startup.log"
events="$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics/app-events.jsonl"
settle_seconds="${COMPANION_GATE_SECONDS:-40}"
service="com.wrazy.workos"
account="stronghold-vault"

if [[ ! -x "$binary" ]]; then
  echo "Packaged app binary is missing: $binary" >&2
  exit 1
fi

# Keep the keychain state of each scenario explicit: a leftover item from an
# earlier step would otherwise decide what the next launch sees.
clear_saved_key() {
  security delete-generic-password -s "$service" -a "$account" >/dev/null 2>&1 || true
}

# An item that this build is not trusted for. The ACL of an item created here
# trusts only the tool that created it, which is exactly the in-place-update
# state: macOS must ask the app before handing the key over.
seed_stale_key() {
  clear_saved_key
  security add-generic-password -s "$service" -a "$account" -w "$(uuidgen)" >/dev/null 2>&1 || true
}

latest_phase() {
  [[ -f "$events" ]] || return 1
  grep -o '"phase":"boot:[a-z_]*"' "$events" | tail -1 | sed 's/.*"phase":"//; s/"$//'
}

# A phase the gate can rest on: anything the app reaches after its own vault
# read settled, including the failure screen that offers recovery.
phase_is_settled() {
  case "$1" in
    boot:connect_screen|boot:workspace_ready|boot:onboarding|boot:waiting_for_data|boot:vault_failed) return 0 ;;
    *) return 1 ;;
  esac
}

run_scenario() {
  local name="$1"
  local pid deadline phase=""
  rm -f "$events"
  : > "$log"
  "$binary" > "$log" 2>&1 &
  pid=$!

  deadline=$((SECONDS + settle_seconds))
  while (( SECONDS < deadline )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[$name] the companion exited during startup" >&2
      cat "$log" >&2
      return 1
    fi
    if phase="$(latest_phase)" && phase_is_settled "$phase"; then
      echo "[$name] boot gate settled at $phase"
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 0
    fi
    sleep 1
  done

  echo "[$name] the companion never got past its loading screen (last phase: ${phase:-none})" >&2
  [[ -f "$events" ]] && tail -20 "$events" >&2
  cat "$log" >&2
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  return 1
}

status=0
clear_saved_key
run_scenario "fresh device" || status=1
seed_stale_key
run_scenario "saved key from an earlier build" || status=1
clear_saved_key
exit "$status"
