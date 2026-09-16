/**
 * Guard for the Windows installer close-fallback ladder. The companion can
 * stay alive past window close (tray design) and can hang mid-exit, and the
 * observed failure mode was an installer stranded by a wedged process while
 * a half-uninstalled copy of the app remained on disk. These assertions keep
 * the escalation ladder present, correctly ordered, and achievable within
 * each step's own code section.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const hooksPath = path.resolve(
  import.meta.dirname,
  "../desktop/work-os-companion/src-tauri/installer-hooks.nsh",
);
const hooks = readFileSync(hooksPath, "utf8");

const LADDER: Array<{ name: string; label: string; required: string[] }> = [
  {
    name: "fast path: current-user kill",
    label: "; Ladder 1: current-user find/kill",
    required: ["KillProcessCurrentUser", "Pop $R8", "Pop $R7"],
  },
  {
    name: "escalation: machine-wide kill",
    label: "; Ladder 2: machine-wide find/kill",
    required: ["nsis_tauri_utils::KillProcess ", "Pop $R7"],
  },
  {
    name: "escalation: taskkill force-kill tree",
    label: "; Ladder 3: taskkill force-kill.",
    required: ["/F /T /IM", "Pop $R7"],
  },
  {
    name: "final fallback: rename-then-continue",
    label: "; Ladder 4: rename the still-running executable aside and continue",
    required: [
      "GetTickCount",
      'Rename "$INSTDIR\\work-os-companion.exe" "$R0"',
      "Delete /REBOOTOK",
    ],
  },
] as const;

/** Slice the code between this ladder's label comment and the next one. */
function section(label: string): string {
  const start = hooks.indexOf(label);
  assert.ok(start >= 0, `ladder label missing: ${label}`);
  const rest = start + label.length;
  const end = rest + hooks.slice(rest).search(/; Ladder \d+:/);
  return hooks.slice(rest, end < rest ? undefined : end);
}

for (const [index, step] of LADDER.entries()) {
  const body = section(step.label);
  for (const required of step.required) {
    assert.ok(body.includes(required), `installer hooks lost the ${step.name} step (${required})`);
  }
  if (index > 0) {
    const previous = hooks.indexOf(LADDER[index - 1].label);
    assert.ok(
      hooks.indexOf(step.label) > previous,
      "ladder order broken: steps must stay in escalation order",
    );
  }
}

// The abort path remains, but only inside the rename fallback failure branch.
const renameAt = hooks.indexOf('Rename "$INSTDIR');
const abortAt = hooks.indexOf("Abort");
assert.ok(abortAt > renameAt, "abort must come after rename fallback");
assert.ok(hooks.includes("work-os-companion.exe"), "process name must stay exact");
assert.ok(hooks.includes("NSIS_HOOK_PREINSTALL"), "install path must call the ladder");
assert.ok(hooks.includes("NSIS_HOOK_PREUNINSTALL"), "uninstall path must call the ladder");
