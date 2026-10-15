#!/usr/bin/env bash
# Packaged Mac startup gate.
#
# Four things are checked against the app the release would ship:
#
#   1. the process survives its first seconds (crash-on-launch),
#   2. no host panic — a panicking vault open (the Stronghold plugin panics
#      instead of returning an error when its salt or vault file cannot be
#      written) leaves the loading screen up forever on every retry,
#   3. the local vault gate SETTLES — the app reaches a boot phase past its
#      loading screen inside the gate timeout — and on a device that can read
#      its saved key it must reach a USABLE phase, not a failure screen,
#   4. that still holds on a device whose saved vault key this build is not
#      trusted for, which is the state an in-place update creates.
#
# Points 2 and 3 are the regressions this script exists for. A first launch on a
# fresh Mac had no app data directory, so the plugin's salt write panicked with
# "Failed to write salt for Stronghold" and the vault never opened; when that
# panic happened on the app's main thread the whole companion froze — the
# loading screen stayed up forever and the mascot could not be dragged. The
# phases below come from the app's own diagnostics log and only advance while its
# windows are alive, so a launch that froze stops at `boot:loading` and fails
# here, and a panicking one fails on its `rust.panic` line.
set -euo pipefail

root="$(pwd)"
binary="$root/src-tauri/target/universal-apple-darwin/release/bundle/macos/Work OS Companion.app/Contents/MacOS/work-os-companion"
log="${RUNNER_TEMP:?}/companion-startup.log"
events="$HOME/Library/Logs/com.wrazy.workos.pilot/diagnostics/app-events.jsonl"
settle_seconds="${COMPANION_GATE_SECONDS:-60}"
service="com.wrazy.workos"
account="stronghold-vault"

if [[ ! -x "$binary" ]]; then
  echo "Packaged app binary is missing: $binary" >&2
  exit 1
fi

# Keep the keychain state of each scenario explicit: a leftover item from an
# earlier step would otherwise decide what the next launch sees. Every call
# reads stdin from /dev/null so a keychain prompt fails instead of blocking the
# release pipeline on a password nobody can type.
clear_saved_key() {
  security delete-generic-password -s "$service" -a "$account" </dev/null >/dev/null 2>&1 || true
}

# An item that this build is not trusted for. The ACL of an item created here
# trusts only the tool that created it, which is exactly the in-place-update
# state: macOS must ask the app before handing the key over.
seed_stale_key() {
  clear_saved_key
  security add-generic-password -s "$service" -a "$account" -w "$(uuidgen)" </dev/null >/dev/null 2>&1 || true
}

latest_phase() {
  [[ -f "$events" ]] || return 1
  grep -o '"phase":"boot:[a-z_]*"' "$events" | tail -1 | sed 's/.*"phase":"//; s/"$//'
}

# The gate's own trail: the boot phases it passed and what the vault answered.
# A runner without a usable keychain settles on the failure screen, and this is
# the line that says so in the job log.
report_gate_trail() {
  [[ -f "$events" ]] || return 0
  grep -E '"category":"(vault|app\.boot)' "$events" | tail -4
}

# A phase the gate can rest on: anything the app reaches after its own vault
# read settled, including the failure screen that offers recovery.
phase_is_settled() {
  case "$1" in
    boot:connect_screen|boot:workspace_ready|boot:onboarding|boot:waiting_for_data|boot:vault_failed) return 0 ;;
    *) return 1 ;;
  esac
}

# A phase that means the app is usable rather than parked on a failure screen.
phase_is_usable() {
  case "$1" in
    boot:connect_screen|boot:workspace_ready|boot:onboarding|boot:waiting_for_data) return 0 ;;
    *) return 1 ;;
  esac
}

# A panicking vault open never resolves its promise, so the app can only show a
# retry screen that panics again. Any host panic fails the gate.
host_panicked() {
  [[ -f "$events" ]] && grep -q '"category":"rust.panic"' "$events"
}

panic_detail() {
  [[ -f "$events" ]] && grep -o '"message":"panicked at[^"]*' "$events" | tail -1 | sed 's/^"message":"//'
}

run_scenario() {
  local name="$1" expectation="$2"
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
      if host_panicked; then
        echo "[$name] the host panicked while opening the local vault: $(panic_detail)" >&2
        report_gate_trail >&2
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        return 1
      fi
      if [[ "$expectation" == "usable" ]] && ! phase_is_usable "$phase"; then
        echo "[$name] settled on a failure screen ($phase) although this device can read its saved key" >&2
        report_gate_trail >&2
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        return 1
      fi
      echo "[$name] boot gate settled at $phase"
      report_gate_trail
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
# A fresh Mac can read its key, so the vault must open: a failure screen here
# means the local vault is broken on first run.
clear_saved_key
run_scenario "fresh device" usable || status=1
seed_stale_key
run_scenario "saved key from an earlier build" settled || status=1
clear_saved_key
exit "$status"
