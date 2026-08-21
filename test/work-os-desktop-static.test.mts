import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../desktop/work-os-companion");
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

const entrypoint = read("src-tauri/src/main.rs");
assert.match(entrypoint, /cfg_attr\(windows, windows_subsystem = "windows"\)/);
assert.doesNotMatch(entrypoint, /cfg_attr\(not\(debug_assertions\), windows_subsystem/);

const rust = read("src-tauri/src/lib.rs");
assert.doesNotMatch(rust, /WebviewUrl::App\("index\.html\?debug=1"/);
assert.doesNotMatch(rust, /get_webview_window\("debug"\)/);
assert.match(rust, /set_focus\(\)/);
const debugHost = read("src-tauri/src/debug_window.rs");
assert.match(debugHost, /WebviewUrl::App\("debug\.html"\.into\(\)\)/);
assert.doesNotMatch(debugHost, /\?debug=1/);

const frontend = read("src/main.tsx");
assert.doesNotMatch(frontend, /getCurrentWindow\(\)\.label === "debug"/);

const onboarding = read("src/Onboarding.tsx");
assert.match(onboarding, /aria-busy=\{busy\}/);
assert.match(onboarding, /role="alert"/);
assert.match(onboarding, /Sign out/);
assert.match(onboarding, /onLogout/);
assert.match(onboarding, /Seen/);
assert.match(onboarding, /Understood/);
assert.match(onboarding, /In control/);
assert.match(onboarding, /Connected/);
assert.match(onboarding, /onSaveDraft/);
const styles = read("src/styles.css");
assert.match(styles, /prefers-reduced-motion/);

const app = read("src/App.tsx");
assert.match(app, /useMemo\(\(\) => applyOnboardingScenario/);
assert.match(app, /finally \{ setBusy\(false\); \}/);
assert.match(app, /openDebuggerWindow/);
assert.match(app, /onboardingState: "complete"/);
assert.match(app, /Couldn’t load Work OS/);
assert.match(app, />Retry</);
assert.match(app, /\/api\/work-os\/me\/workday/);
assert.match(app, /source: "desktop"/);
assert.match(app, /unscheduled_acknowledged: true/);
assert.match(app, /\/api\/work-os\/me\/plan\/removals/);
assert.doesNotMatch(app, /Clock in through Worktivity/);
assert.doesNotMatch(app, /Fallback clock in/);
assert.doesNotMatch(app, /Attendance managed by Worktivity/);
assert.match(app, /\/api\/work-os\/me\/plan/);
assert.match(app, /"PUT"/);
assert.match(app, /Add outcome/);
assert.match(app, /Convert to Nifty/);
assert.match(app, /\/api\/work-os\/me\/insights\?range=/);
assert.match(app, /Exact personal insight values/);
assert.match(app, /Restart onboarding/);
assert.match(app, /\/api\/work-os\/me\/onboarding[\s\S]*method: "DELETE"/);
assert.match(app, /secureState\.clearAccount\(\)/);
assert.match(app, /Account session/);
assert.match(app, /ui\.action\.blocked/);
assert.match(app, /shiftPulse/);
assert.doesNotMatch(app, /width: active \? "42%"/);
assert.match(app, /Promise\.allSettled/);
assert.match(app, /bootstrap\.day\.degraded/);
assert.match(app, /PersonalInsights/);
assert.match(app, /observedSeconds/);
assert.doesNotMatch(app, /width: "(?:76|52|34)%"/);
assert.doesNotMatch(app, /will enter the plan at explicit clock-in/);
assert.match(app, /Worktivity session detected/);
assert.match(app, /view === "tasks"/);
assert.match(app, /Load more/);
assert.match(app, /role="dialog"/);
assert.match(app, /assignee_person_ids/);
assert.match(app, /openTaskDetails/);
assert.match(app, /Add a subtask/);
assert.match(app, /Delete task/);
assert.match(app, /method: "DELETE"/);
assert.match(app, /role="alertdialog"/);
assert.match(app, /requestTaskRemoval/);
assert.match(app, /Move to/);
assert.match(app, /method: "PATCH"/);
assert.match(app, /MoreHorizontal/);
assert.doesNotMatch(app, /if \(!window\.confirm\(warning\)\)/);
assert.doesNotMatch(app, /openTaskComposer\(task\)/);
assert.doesNotMatch(app, /Nifty task group ID/);
assert.doesNotMatch(app, /task_group_id: taskComposer/);
assert.match(read("src/sessionGate.ts"), /Clock in explicitly/);
assert.doesNotMatch(app, /disabled=\{!active \|\| !input\.trim\(\) \|\| busy\}/);

const debugWindow = read("src/DebugWindow.tsx");
assert.match(debugWindow, /if \(!isTauri\(\)\)/);
for (const event of ["work-os://debug-request", "work-os://debug-current", "work-os://debug-scenario"]) {
  assert.match(debugWindow, new RegExp(event.replaceAll("/", "\\/")));
}
assert.match(debugWindow, /\.\.\.DEFAULT_DEBUG_SCENARIO, \.\.\.preset/);
const main = read("src/main.tsx");
const debug = read("src/debug.tsx");
const debugHtml = read("debug.html");
assert.doesNotMatch(main, /import DebugWindow/);
assert.match(debug, /import DebugWindow from "\.\/DebugWindow"/);
assert.match(debugHtml, /src="\/src\/debug\.tsx"/);
assert.match(read("vite.config.ts"), /debug: resolve\(__dirname, "debug\.html"\)/);
assert.match(read("src-tauri/capabilities/debug.json"), /allow-debug-commands/);
assert.match(read("src-tauri/capabilities/default.json"), /allow-app-commands/);
assert.match(read("src-tauri/permissions/allow-app-commands.toml"), /open_debug_window/);

const companionServer = readFileSync(resolve(import.meta.dirname, "../src/lib/work-os-companion.ts"), "utf8");
assert.match(companionServer, /refreshNiftyMirror/);
assert.match(companionServer, /syncing: !niftyFresh/);
assert.doesNotMatch(companionServer, /const result = await syncNifty\(ownerId\)/);
assert.match(companionServer, /role", "admin"/);
assert.match(companionServer, /Assignees must be active, Nifty-mapped non-admin organization members/);
assert.match(companionServer, /getWorkOsEmployeeTaskDetails/);
assert.match(companionServer, /archiveWorkOsEmployeeTask/);
assert.match(companionServer, /moveWorkOsEmployeeSubtask/);
assert.match(companionServer, /task\.subtask_moved/);
assert.match(companionServer, /task\.archived/);

const api = read("src/api.ts");
assert.match(api, /AbortSignal\.timeout\(20_000\)/);
assert.match(api, /observed_at: body\.observed_at \?\? createdAt/);
assert.match(api, /Idempotency-Key/);
assert.match(api, /flushQueue/);
assert.match(api, /\/api\/work-os\/me\/day/);

const tauri = read("src-tauri/tauri.conf.json");
assert.match(tauri, /"frontendDist": "\.\.\/dist"/);
assert.match(tauri, /"useHttpsScheme": true/);
assert.match(tauri, /"label": "debug"[\s\S]*"url": "debug\.html"[\s\S]*"visible": false/);
assert.doesNotMatch(tauri, /localhost:1420/);
assert.match(tauri, /com\.wrazy\.workos\.pilot/);
assert.match(tauri, /\/home\/zahemen\/\.nvm\/versions\/node\/v22\.14\.0\/bin\/npm/);

const msi = read("installer/windows-pilot.wxs");
assert.match(msi, /WebView2Loader\.dll/);
assert.match(msi, /wrazy-workos/);
assert.match(msi, /WorkOsCompanionShortcut/);

const nsis = read("installer/windows-pilot.nsi");
assert.match(nsis, /SetOverwrite on/);
assert.match(nsis, /taskkill \/IM "Work OS Companion\.exe"/);
assert.match(nsis, /taskkill \/IM "work-os-companion\.exe"/);
assert.match(nsis, /MUI_FINISHPAGE_RUN "\$INSTDIR\\\$\{PRODUCT_EXE\}"/);
assert.match(nsis, /MUI_FINISHPAGE_RUN_TEXT "Run Work OS Companion"/);
assert.doesNotMatch(nsis, /MUI_FINISHPAGE_RUN_NOTCHECKED/);

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/work-os-companion-windows.yml"), "utf8");
assert.match(workflow, /Missing release signing secrets/);
assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
assert.match(workflow, /WINDOWS_CERTIFICATE_BASE64/);

console.log("Work OS desktop static checks passed.");
