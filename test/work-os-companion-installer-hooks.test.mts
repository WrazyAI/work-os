/**
 * Guard for the Windows installer close-fallback ladder. The companion can
 * stay alive past window close (tray design) and can hang mid-exit, and the
 * observed failure mode was an installer stranded by a wedged process while
 * a half-uninstalled copy of the app remained on disk. These assertions keep
 * the escalation ladder present and correctly ordered.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const hooksPath = path.resolve(
  import.meta.dirname,
  "../desktop/work-os-companion/src-tauri/installer-hooks.nsh",
);
const hooks = readFileSync(hooksPath, "utf8");

const LADDER = [
  ["fast path: current-user kill", "KillProcessCurrentUser", "KillProcess"],
  ["escalation: machine-wide kill", "nsis_tauri_utils::KillProcess ", "KillProcessCurrentUser"],
  ["escalation: taskkill force-kill tree", "/F /T /IM", "KillProcess "],
  ["final fallback: rename-then-continue", 'Rename "$INSTDIR\\work-os-companion.exe"', "/F /T /IM"],
  ["uninstall path covered too", "NSIS_HOOK_PREUNINSTALL", 'Rename "$INSTDIR'],
] as const;

let last = 0;
for (const [name, marker, after] of LADDER) {
  assert.ok(hooks.includes(marker), `installer hooks lost the ${name} step (${marker})`);
  const at = hooks.indexOf(marker);
  assert.ok(
    at > hooks.indexOf(after),
    `installer hooks ladder order broken: ${name} must follow ${after}`,
  );
  last = at;
}
assert.ok(last > 0, "ladder steps should appear after their prerequisites");

// Result conventions: every executed find/kill/plugin call in a branch must
// have its result popped. Compile-time !if branches are counted textually,
// so assert concrete minimums rather than exact per-call pairing.
assert.ok((hooks.match(/Pop \$R8/g) ?? []).length >= 3, "find results must be popped");
assert.ok((hooks.match(/Pop \$R7/g) ?? []).length >= 3, "kill/taskkill results must be popped");

// The abort path remains, but only after the rename fallback fails.
const abortAt = hooks.indexOf("Abort");
assert.ok(abortAt > hooks.indexOf("Rename \"$INSTDIR"), "abort must come after rename fallback");
assert.ok(hooks.includes("work-os-companion.exe"), "process name must stay exact");
