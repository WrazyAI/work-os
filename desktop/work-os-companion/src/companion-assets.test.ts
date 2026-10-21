import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function pngColorType(path: string) {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 8).toString("binary")).toBe("\x89PNG\r\n\x1a\n");
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return buf[25];
}

describe("companion artwork", () => {
  it("ships a true-alpha PNG so the checkerboard never renders", () => {
    expect(pngColorType(resolve(root, "public/work-os-companion.png"))).toBe(6);
  });

  it("composites the mascot over dark UI without screen blending", () => {
    const css = readFileSync(resolve(root, "src/otto.css"), "utf8");
    expect(css).not.toMatch(/mix-blend-mode:\s*screen/);
    const stageCss = readFileSync(resolve(root, "src/onboarding-stage.css"), "utf8");
    expect(stageCss).toMatch(/\.mascot-stage\s*\{/);
    expect(stageCss).toMatch(/\.mascot-stage-art\s*\{/);
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain('from "./MascotPet"');
    // The connect screen is the first-run stage's first frame, so its mascot is
    // the stage's figure — one art path, not a second hero that could drift.
    expect(app).toContain('import { OnboardingStage } from "./OnboardingStage"');
    expect(app).toContain('pose="waiting"');
    expect(app).not.toContain("mascot-connect");
    expect(app).not.toContain("work-os-task-stack");
  });

  it("includes the redesign styles in the packaged application entrypoint", () => {
    const main = readFileSync(resolve(root, "src/main.tsx"), "utf8");
    expect(main).toContain('import "./styles.css"');
    expect(main).toContain('import "./workspace-redesign.css"');
    expect(main).toContain('import "./otto.css"');
    expect(readFileSync(resolve(root, "src/App.tsx"), "utf8")).toContain('import "./plan-insights.css"');
    expect(readFileSync(resolve(root, "src/workspace-redesign.css"), "utf8")).toContain(".workspace");
  });

  it("uses an alpha PNG for the packaged app icon", () => {
    expect(pngColorType(resolve(root, "src-tauri/icons/icon.png"))).toBe(6);
  });

  it("keeps the compact mascot free of a halo and repeats the shared alert pose", () => {
    const avatar = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");
    const pet = readFileSync(resolve(root, "src/MascotPet.tsx"), "utf8");
    const avatarCss = readFileSync(resolve(root, "src/avatar.css"), "utf8");
    const conversationCss = readFileSync(resolve(root, "src/chat/conversation.css"), "utf8");
    const studioCss = readFileSync(resolve(root, "src/studio-otto.css"), "utf8");

    expect(avatar).not.toContain("avatar-ring");
    expect(conversationCss).not.toContain("avatar-ring");
    expect(avatarCss).not.toContain(".avatar-orb::before");
    expect(conversationCss).toMatch(/\.avatar-orb\s*\{[^}]*background:\s*transparent/s);
    expect(avatar).toContain('const showBadge = mascotVisual.pose === "alert"');
    expect(avatar).toContain('showBadge ? `${MASCOT.name}: ${mascotVisual.label}. Open companion to respond.`');
    expect(avatar).toContain('className={`avatar-badge${showShiftTime && !showBadge ? " avatar-badge-progress"');
    expect(avatar).toContain("style={showShiftTime && !showBadge && progressAvailable");
    expect(pet).toContain('useAttentionSequence(visual.pose === "alert", reduced, replayKey)');
    expect(avatar).toContain("facts.lateReasonRequired || !!agendaReview");
    expect(avatar).toContain("chat.some((entry) => hasPendingMascotApproval");
    expect(avatarCss).toMatch(/animation: avatarAttention 550ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) infinite;/);
    expect(avatarCss).toContain('.avatar-orb:has(.mascot-pet[data-attention-playing="true"]) { animation: none; }');
    expect(studioCss).toMatch(/studio-attention-rig 520ms steps\(5, end\) infinite;/);
    expect(studioCss).toMatch(/studio-attention-head 520ms steps\(5, end\) infinite;/);
    expect(studioCss).toMatch(/studio-attention-wave 520ms steps\(5, end\) infinite;/);
  });
});

describe("companion launch window", () => {
  it("opens at the polished desktop viewport instead of the compressed layout", () => {
    const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
    const mainWindow = config.app.windows.find((window: { label?: string }) => window.label === "main");
    const avatarWindow = config.app.windows.find((window: { label?: string }) => window.label === "avatar");

    expect(mainWindow).toMatchObject({
      width: 1000,
      height: 960,
      center: true,
      resizable: true,
    });
    expect(avatarWindow).toMatchObject({ width: 200, height: 276, resizable: false });
  });

  it("permits blob and data images so authenticated screenshot previews render", () => {
    const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
    const csp = String(config.app.security.csp);
    const imgSrc = csp.split(";").map((part: string) => part.trim()).find((part: string) => part.startsWith("img-src"));
    expect(imgSrc).toContain("blob:");
    expect(imgSrc).toContain("data:");
    const gallery = readFileSync(resolve(root, "src/ScreenshotGallery.tsx"), "utf8");
    expect(gallery).toContain("URL.createObjectURL");
    expect(gallery).toContain("onError={() => { setFailed(true); setUrl(null); }}");
  });
});

describe("floating companion integration", () => {
  it("permits native dragging and uses direct day reads", () => {
    const capability = JSON.parse(readFileSync(resolve(root, "src-tauri/capabilities/avatar.json"), "utf8"));
    const avatar = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");
    const avatarLogic = readFileSync(resolve(root, "src/avatarLogic.ts"), "utf8");

    expect(capability.permissions).toContain("allow-avatar-commands");
    const avatarCommands = readFileSync(resolve(root, "src-tauri/permissions/allow-avatar-commands.toml"), "utf8");
    expect(avatarCommands).toContain("hide_avatar");
    expect(avatarCommands).toContain("show_avatar");
    const rustShell = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(rustShell).toContain("fn hide_avatar");
    expect(rustShell).toContain("fn show_avatar");
    expect(rustShell).toContain("fn toggle_companion");
    expect(rustShell).toMatch(/fn hide_avatar[\s\S]*sync_companion_item/);
    expect(rustShell).toMatch(/fn show_avatar[\s\S]*sync_companion_item/);
    expect(rustShell).toContain('"companion"');
    expect(avatar).toContain('invoke("hide_avatar")');
    expect(avatar).toContain("avatar-hide");
    expect(avatar).toContain("avatar-head-actions");
    expect(avatar.match(/aria-label="Collapse companion"/g)).toHaveLength(2);
    expect(avatar).toContain('title="Collapse companion"');
    expect(avatar).not.toContain("Minimize to orb");
    expect(avatar).toContain("nextAgendaAutoExpand");
    expect(avatar).toContain('from "lucide-react"');
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
    // macOS consumes the first click on an inactive window unless the webview
    // accepts it, which would make the floating companion need a second grab.
    const dragConfig = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
    const dragWindow = dragConfig.app.windows.find((window: { label?: string }) => window.label === "avatar");
    expect(dragWindow).toMatchObject({ acceptFirstMouse: true });
    // The avatar reads the shared cached day query instead of its own fetch.
    expect(avatar).toContain('workOsKeys.day("compact")');
    expect(avatar).toContain('fetchDay({ variant: "compact" })');
    expect(avatar).toContain('fetchDay({ variant: "details" })');
    expect(avatar).toContain("staleTime: force ? 0 : DAY_STALE_MS");
    expect(avatar).toContain("recoveredStartValue");
    expect(avatarLogic).toContain('remaining: "Time unavailable"');
    expect(avatar).toContain("hasValidShiftWindow");
    expect(avatar).toContain("schedule: null");
    expect(avatar).toContain("hasOpenShiftSession(facts)");
    expect(avatar).toContain('const elapsedText = label ? `${label} elapsed` : "Elapsed time unavailable"');
    expect(avatar).toContain('const progressText = progressAvailable ? `${Math.round(fraction * 100)}% of shift complete` : "Shift progress unavailable"');
    expect(avatar).toContain("!progressAvailable");
    expect(avatar).not.toContain('"/api/work-os/me/day", { method: "POST"');
    expect(avatar).toContain('"work-os://main-day-changed"');
    expect(avatar).toContain("facts.taskOptions");
    expect(avatar).toContain("ApprovalFlow");
    expect(avatar).toContain("avatar-drag-surface");
    expect(avatar).toContain("setSnoozeReplayId((value) => value + 1)");
    expect(avatar).toContain("replayKey={snoozeReplayId}");
    const mascotPet = readFileSync(resolve(root, "src/MascotPet.tsx"), "utf8");
    expect(mascotPet).toContain("useAttentionSequence(visual.pose === \"alert\", reduced, replayKey)");
    const attentionSequence = readFileSync(resolve(root, "src/attentionSequence.ts"), "utf8");
    expect(attentionSequence).toContain("[enabled, reducedMotion, replayKey]");
    const avatarStyles = readFileSync(resolve(root, "src/avatar.css"), "utf8");
    expect(avatar).not.toContain("avatar-orb-state");
    expect(avatar).toContain("avatar-day-time");
    const chatPreview = readFileSync(resolve(root, "src/ChatPreview.tsx"), "utf8");
    expect(chatPreview).not.toContain("avatar-orb-state");
    expect(chatPreview).toContain("avatar-day-time");
    expect(avatarStyles).not.toContain(".avatar-orb-state");
    expect(avatarStyles).toContain(".avatar-day-time");
    expect(avatarStyles).toMatch(/\.avatar-prompt-bubble strong\s*\{[^}]*font-size:\s*12px;/);
    expect(avatarStyles).toMatch(/\.avatar-prompt-bubble span\s*\{[^}]*font-size:\s*11px;/);
    expect(avatarStyles).toMatch(/\.avatar-drag-surface\s*\{[^}]*top:\s*22px;[^}]*left:\s*50%;[^}]*width:\s*52px;[^}]*height:\s*28px;[^}]*transform:\s*translateX\(-50%\);[^}]*background:\s*transparent;[^}]*font-size:\s*7px;/);
    expect(avatarStyles).toMatch(/\.avatar-drag-surface::before\s*\{[^}]*width:\s*36px;[^}]*height:\s*15px;[^}]*background:\s*rgba\(32, 36, 33, \.9\);/);
    expect(avatarStyles).toMatch(/\.avatar-hide\s*\{[^}]*top:\s*20px;[^}]*right:\s*9px;[^}]*width:\s*21px;[^}]*height:\s*21px;/);
    expect(avatarStyles).toMatch(/\.avatar-prompt-bubble ~ \.avatar-hide\s*\{[^}]*top:\s*58px;/);
    const conversationStyles = readFileSync(resolve(root, "src/chat/conversation.css"), "utf8");
    expect(conversationStyles).toMatch(/\.avatar-compact\s*\{[^}]*width:\s*200px;[^}]*height:\s*276px;/);
    expect(conversationStyles).toMatch(/\.avatar-orb\s*\{[^}]*width:\s*144px;[^}]*height:\s*154px;[^}]*margin:\s*76px 28px 0;/);
    expect(conversationStyles).toMatch(/\.avatar-drag-surface\s*\{[^}]*top:\s*22px;[^}]*left:\s*50%;[^}]*width:\s*52px;[^}]*height:\s*28px;[^}]*transform:\s*translateX\(-50%\);[^}]*background:\s*transparent;[^}]*font-size:\s*7px;/);
    expect(conversationStyles).toMatch(/\.avatar-drag-surface::before\s*\{[^}]*width:\s*36px;[^}]*height:\s*15px;[^}]*background:\s*rgba\(32, 36, 33, 0\.9\);/);
    // A bubble floats above the figure and never moves it, so the elapsed
    // pill can never land on the mascot.
    expect(conversationStyles).not.toContain(".avatar-prompt-bubble ~ .avatar-orb");
    expect(avatarStyles).not.toContain(".avatar-prompt-bubble ~ .avatar-orb");
    expect(avatarStyles).toMatch(/\.avatar-recap-bubble\s*\{[^}]*top:\s*2px;[^}]*max-height:\s*92px;/);
    expect(avatarStyles).toMatch(/\.avatar-recap-bubble > span\s*\{[^}]*line-clamp:\s*1;/);
    expect(avatarStyles).toMatch(/\.avatar-prompt-bubble span\s*\{[^}]*line-clamp:\s*1;/);
    expect(avatarStyles).toMatch(/\.avatar-prompt-open strong\s*\{[^}]*line-clamp:\s*1;/);
    const accessibilityStyles = readFileSync(resolve(root, "src/accessibility.css"), "utf8");
    expect(accessibilityStyles).toMatch(/html\[data-mascot-size="small"\] \.avatar-compact \.avatar-drag-surface\s*\{[^}]*top:\s*47px;/);
    expect(accessibilityStyles).toMatch(/html\[data-mascot-size="small"\] \.avatar-compact \.avatar-prompt-bubble \+ \.avatar-drag-surface\s*\{[^}]*top:\s*58px;/);
    expect(accessibilityStyles).toMatch(/html\[data-mascot-size="small"\] \.avatar-compact \.avatar-hide\s*\{[^}]*top:\s*45px;/);
    expect(accessibilityStyles).toMatch(/html\[data-mascot-size="small"\] \.avatar-compact \.avatar-prompt-bubble ~ \.avatar-hide\s*\{[^}]*top:\s*58px;/);
    expect(avatar).toContain("/api/work-os/me/proposals");
    expect(avatar).toContain('decision: "reject"');
    expect(avatar).toContain("TaskSelectionCard");
    expect(avatar).toContain("proposeAvatarSelectedCompletions");
  });

  it("shares the per-workday conversation between the main window and avatar", () => {
    const vault = readFileSync(resolve(root, "src/vault.ts"), "utf8");
    const main = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    const avatar = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");

    expect(vault).toContain("saveConversation");
    expect(vault).toContain("clearConversation");
    expect(main).toContain("composerConversationScope");
    expect(main).toContain("ApprovalFlow");
    expect(avatar).toContain("avatarConversationScope");
    expect(main).toContain("workday:${visibleSession.organizationId}:${visibleDay.access.personId}:${visibleDay.shiftDate}");
    expect(avatar).toContain("workday:${desktopSession.organizationId}:${facts.personId}:${facts.shiftDate}");
    expect(main).toContain('"work-os://conversation-changed"');
    expect(avatar).toContain('"work-os://conversation-changed"');
    expect(avatar).toContain("const history = [...chat.filter");
    expect(avatar).toContain("const promptTurnId = attentionDue");
    expect(main).toContain("proposeSelectedTaskCompletions");
    expect(main).toContain("TaskSelectionCard");
  });

  it("celebrates a confirmed outcome twice as long and returns alert-opened recaps to the orb", () => {
    const studioStyles = readFileSync(resolve(root, "src/studio-otto.css"), "utf8");
    expect(studioStyles).toContain("studio-celebrate-rig 520ms steps(5, end) 4 both");
    expect(studioStyles).toContain("studio-celebrate-head 520ms steps(5, end) 4 both");
    expect(studioStyles).toContain("studio-celebrate-left 520ms steps(5, end) 4 both");
    expect(studioStyles).toContain("studio-celebrate-right 520ms steps(5, end) 4 both");
    const runtime = readFileSync(resolve(root, "src/useMascotRuntime.ts"), "utf8");
    expect(runtime).toContain("const READY_MS = 3_600;");
    const avatar = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");
    expect(avatar).toContain("setReadyPulse(false), 2_900");
    expect(avatar).toContain("nextStepsSettleMs");
    expect(avatar).toContain("RecapNextStepsCard");
    const queries = readFileSync(resolve(root, "src/workOsQueries.ts"), "utf8");
    expect(queries).toContain("/next-steps");
  });

  it("opens Settings with Ctrl+, from either window", () => {
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain("isSettingsHotkey(event)");
    expect(app).toContain('setView("settings")');
    const avatar = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");
    expect(avatar).toContain("isSettingsHotkey(event)");
    expect(avatar).toContain('navigateToPage("settings")');
    const sidebar = readFileSync(resolve(root, "src/SidebarNav.tsx"), "utf8");
    expect(sidebar).toContain('"Ctrl + ,"');
  });

  it("names the EOD drafting action for what it does", () => {
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain('"Draft today’s EOD"');
    expect(app).not.toContain('"Drafts today’s EOD"');
    expect(app).not.toContain('"Create EOD draft"');
  });

  it("pages the debugger trace from a 1,000-event ring and destroys the debugger on close", () => {
    const debugWindow = readFileSync(resolve(root, "src/DebugWindow.tsx"), "utf8");
    expect(debugWindow).toContain("getCurrentWindow().close()");
    expect(debugWindow).not.toContain("getCurrentWindow().hide()");
    const trace = readFileSync(resolve(root, "src/DebugTrace.tsx"), "utf8");
    expect(trace).toContain('"work-os://diagnostics-changed"');
    expect(trace).not.toContain('"work-os://diagnostics"');
    const host = readFileSync(resolve(root, "src-tauri/src/diagnostics.rs"), "utf8");
    expect(host).toContain("pub fn diagnostics_page(");
    expect(host).not.toContain("diagnostics_snapshot");
    expect(host).toContain("schedule_debug_notice(app, seq)");
    expect(host).toContain('"work-os://diagnostics-changed"');
    expect(host).toContain("Duration::from_millis(250)");
    const core = readFileSync(resolve(root, "src-tauri/diagnostics-core/src/lib.rs"), "utf8");
    expect(core).toContain("pub const RING_LIMIT: usize = 1000;");
    const debugPermissions = readFileSync(resolve(root, "src-tauri/permissions/allow-debug-commands.toml"), "utf8");
    expect(debugPermissions).toContain('"diagnostics_page"');
    expect(debugPermissions).not.toContain("diagnostics_snapshot");
    const appPermissions = readFileSync(resolve(root, "src-tauri/permissions/allow-app-commands.toml"), "utf8");
    expect(appPermissions).not.toContain("diagnostics_snapshot");
  });

  // The vault key lives in the OS credential store, and on macOS that read can
  // wait on a system password dialog (an in-place update changes the app's
  // ad-hoc signature, so the saved item stops matching). That read ran inside a
  // synchronous command on the main thread and froze every window, which is the
  // frozen loading screen and the mascot that could not be dragged.
  it("keeps the credential store off the main thread and answers one dialog per launch", () => {
    const host = readFileSync(resolve(root, "src-tauri/src/vault_password.rs"), "utf8");
    expect(host).toMatch(/pub async fn get_vault_password/);
    expect(host).toMatch(/pub async fn reset_local_vault/);
    expect(host).toContain("spawn_blocking");
    expect(host).toContain("vault::serve");
    // The rules that broke live in the core crate, where they are tested
    // without a keychain.
    const core = readFileSync(resolve(root, "src-tauri/vault-password-core/src/lib.rs"), "utf8");
    expect(core).toContain("pub const LEGACY_ACCOUNT: &str = \"stronghold-vault\";");
    expect(core).toMatch(/StoreAnswer::Missing if vault_exists => StoreDecision::UnlockFailed/);
    expect(core).toContain("fn reset_replaces_the_vault_id_so_a_stale_credential_cannot_block_a_restart");
    const vault = readFileSync(resolve(root, "src/vault.ts"), "utf8");
    expect(vault).toContain('invoke<string>("get_vault_password")');
    expect(vault).toContain('invoke("reset_local_vault")');
    expect(vault).toContain("abandonVaultOpen");
    const gate = readFileSync(resolve(root, "src/vaultGate.ts"), "utf8");
    expect(gate).toContain("VAULT_GATE_TIMEOUT_MS");
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toMatch(/runVaultGate\(\s*\(\) => applyVaultStateRef\.current\(\)/);
    // The gate asks the host whether a panic lost the open, so a vault that can
    // never load offers the recovery that replaces it instead of Retry forever.
    expect(app).toContain('invoke<boolean>("vault_open_trouble")');
    // StrictMode mounts, cleans up, and mounts again: a "started once" guard
    // would leave the second mount without a live attempt and strand the gate
    // on its loading screen.
    expect(app).not.toContain("vaultStartedRef");
    expect(app).toContain("boot:vault_failed");
    const startup = readFileSync(resolve(root, "scripts/check-macos-startup.sh"), "utf8");
    expect(startup).toContain("boot:vault_failed");
    expect(startup).toContain("seed_stale_key");
    // A panicking vault open leaves a retry screen that panics again, so the
    // packaged-Mac gate fails on any host panic and requires a usable phase
    // wherever the saved key is readable.
    expect(startup).toContain("host_panicked");
    expect(startup).toContain("rust.panic");
    expect(startup).toMatch(/run_scenario "fresh device" usable/);
  });

  // A first launch on a fresh Mac had no app data directory, so the Stronghold
  // plugin's salt write panicked ("Failed to write salt for Stronghold", Os
  // code 2) and the vault never opened — on that machine, forever.
  it("creates the vault's directories before the Stronghold plugin writes its salt", () => {
    const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    const setup = rust.slice(rust.indexOf(".setup(|app| {"));
    const createAt = setup.indexOf("ensure_vault_directories");
    const saltAt = setup.indexOf("with_argon2");
    expect(createAt).toBeGreaterThan(-1);
    expect(saltAt).toBeGreaterThan(-1);
    expect(createAt).toBeLessThan(saltAt);
    expect(setup).toContain("app_local_data_dir()?");
    expect(setup).toContain("app_data_dir()?");
    expect(rust).toMatch(/fn ensure_vault_directories[\s\S]{0,400}ensure_directories/);
    const core = readFileSync(resolve(root, "src-tauri/vault-password-core/src/lib.rs"), "utf8");
    expect(core).toMatch(/pub fn ensure_directories[\s\S]{0,400}create_dir_all/);
    // The rules crate is the one CI can run without a desktop toolchain.
    const ci = readFileSync(resolve(root, "../../.github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("cargo test --manifest-path src-tauri/vault-password-core/Cargo.toml");
  });

  it("grants the recovery command to every window that can hit a broken vault", () => {
    const permissions = readFileSync(resolve(root, "src-tauri/permissions/allow-app-commands.toml"), "utf8");
    expect(permissions).toContain('"get_vault_password"');
    expect(permissions).toContain('"reset_local_vault"');
    expect(permissions).toContain('"vault_open_trouble"');
    const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(rust).toContain("vault_password::get_vault_password");
    expect(rust).toContain("vault_password::reset_local_vault");
    expect(rust).toContain("vault_password::vault_open_trouble");
    expect(rust).toContain("vault_password::init(app.handle())");
  });

  // An expired stored session used to open the workspace while the API layer
  // refused it, so every request failed with "Connect this device to WrazyOS."
  // and nothing said why. The screens and the API layer share one rule now, and
  // a rejected session signs the device out.
  it("keeps the screens and the API layer on one session rule", () => {
    const api = readFileSync(resolve(root, "src/api.ts"), "utf8");
    expect(api).toContain('import { isSessionExpired } from "./sessionState"');
    expect(api).toContain("if (!session || isSessionExpired(session))");
    expect(api).not.toContain("new Date(session.expiresAt).getTime() <=");
    expect(api).toContain("dropRejectedSession(path)");
    expect(api).toContain('"work-os://desktop-session-rejected"');
    const vault = readFileSync(resolve(root, "src/vault.ts"), "utf8");
    expect(vault).toContain("sessionStateFrom(await get<DesktopSession>(\"session\"), httpsOrigin)");
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain("secureState.sessionState()");
    expect(app).toContain("setConnectNotice(sessionNotice(stored.reason))");
    expect(app).toContain('listen("work-os://desktop-session-rejected"');
    expect(app).toContain('notice={connectNotice}');
    expect(app).toContain("otto-bubble-notice");
    const preview = readFileSync(resolve(root, "src/LoadingPreview.tsx"), "utf8");
    expect(preview).toContain("connect-signed-out");
  });
});

describe("floating companion recap voice", () => {
  // Reading a recap aloud: the bubble offers it, the prompter shows the spoken
  // words, the window grows without moving Otto, and nothing here may become a
  // second source of the words the server already fixed.
  it("reads a recap from the bubble with one audio owner", () => {
    const avatar = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");
    expect(avatar).toContain("createRecapSpeechPlayer(");
    expect(avatar).toContain("toggleRecapRead(pendingRecap.id, pendingRecap.revision ?? null)");
    expect(avatar).toContain("grownWindow(RECAP_BUBBLE_RESTING");
    expect(avatar).toContain("<RecapPrompter");
    expect(avatar).toContain("avatar-bubble-listen");
    // Never a second copy of the spoken words: they come from the route.
    expect(avatar).not.toContain("buildRecapSpeechLines");
    // Both hide paths stop the read, a hidden window stops it, and a recording
    // takes the audio over.
    expect(avatar.match(/stopRecapRead\(\); stopNextStepsRead\(\); void invoke\("hide_avatar"\)/g)).toHaveLength(2);
    expect(avatar).toContain('if (voice.state !== "idle") stopRecapRead();');
    expect(avatar).toContain('if (document.visibilityState === "hidden") stopRecapRead();');
    const css = readFileSync(resolve(root, "src/avatar.css"), "utf8");
    expect(css).toContain(".avatar-bubble-listen");
    expect(css).toContain(".avatar-reading-dots");
    expect(css).toContain("@keyframes avatar-reading-dot");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]{0,140}avatar-reading-dots i \{ animation: none/);
  });

  it("shows the approved recap's next steps in the bubble with one audio owner", () => {
    const avatar = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");
    expect(avatar).toContain("<NextStepsBubble");
    expect(avatar).toContain("nextStepsWindow(");
    expect(avatar).toContain('apiRequestAudio("/api/work-os/voice/next-steps"');
    // The words come from the route, exactly like the recap read.
    expect(avatar).not.toContain("buildNextStepsSpeechLines");
    // Confirming a recap must never open the panel by itself.
    const start = avatar.indexOf("const startNextStepsMoment");
    const end = avatar.indexOf("setNextStepsBubbleId(entryId);", start);
    const slice = avatar.slice(start, end);
    expect(slice).not.toContain("toggleExpanded(true)");
    expect(slice).toContain("options?.bubble !== false");
    // The success beat belongs to the finished list, after the last decision.
    expect(avatar).toContain("nextStepsHasFailure(nextStepsMoment)");
    expect(avatar).toContain("setNextStepsCelebration(true)");
    // One audio owner across both reads.
    expect(avatar).toContain('if (recapSpeech.status !== "idle") nextStepsPlayer.stop();');
    expect(avatar).toContain('if (nextStepsSpeech.status !== "idle") recapPlayer.stop();');
    const css = readFileSync(resolve(root, "src/avatar.css"), "utf8");
    expect(css).toContain(".avatar-next-steps-list");
    expect(css).toContain('[data-next-steps]');
    expect(css).toContain("max-height: 312px");
  });
});

describe("app quit", () => {
  it("asks the webview for a clean-exit breadcrumb before the host quits", () => {
    const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    // The tray item and a user-initiated ExitRequested both go through the
    // helper, and the helper keeps the exit watchdog armed behind it.
    expect(rust).toContain('"work-os://app-quit"');
    expect(rust).toMatch(/"quit" => request_clean_exit\(app\)/);
    expect(rust).toMatch(/fn request_clean_exit[\s\S]{0,600}arm_exit_watchdog/);
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain('listen("work-os://app-quit"');
  });
});

describe("hold-to-talk routing", () => {
  it("never records into a window the employee cannot see", () => {
    const rust = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    /* A minimized window can still report focus on Windows, so the hold has to
       check that the app is on screen as well: otherwise the capture runs in a
       window that shows nothing and its suspended webview leaves the
       transcript stuck on "Transcribing…". */
    expect(rust).toContain("fn main_window_state");
    expect(rust).toMatch(/fn main_window_state[\s\S]*is_minimized/);
    expect(rust).toMatch(/fn voice_route[\s\S]*focused && !hidden/);
    expect(rust).not.toContain("fn voice_target");
    /* The routing decision names what the host saw, so the log says which
       window owned the capture and why. */
    expect(rust).toContain("app focused={}, app on screen={}");
  });

  it("keeps a background webview working so an upload can finish", () => {
    const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
    expect(config.app.windows.length).toBeGreaterThan(0);
    for (const window of config.app.windows) {
      const args = String(window.additionalBrowserArgs ?? "");
      /* Chromium suspends a webview that is not in front, and a suspended
         webview never finishes an upload. Every window keeps running. */
      expect(args).toContain("--disable-renderer-backgrounding");
      expect(args).toContain("--disable-backgrounding-occluded-windows");
      expect(args).toContain("--disable-background-timer-throttling");
    }
  });
});

describe("interval recap scheduler", () => {
  it("re-arms the nudge at the prompt's due instant", () => {
    const app = readFileSync(resolve(root, "src/AvatarApp.tsx"), "utf8");
    /* The scheduler runs on dependency changes, not on the clock tick. A prompt
       that becomes due between two day polls needs the due boundary in its
       deps, or the interval recap is never requested and the generic check-in
       stands in for it. */
    expect(app).toContain("promptNudgeDue(facts, now)");
    expect(app).toMatch(/eodAlertNow, clockInAlertNow, promptDueNow\]/);
  });
});

describe("preview fixtures are recognised as fixtures", () => {
  it("lists every fixture, so the day poll never clears a fixture's bubble", () => {
    const source = readFileSync(new URL("./avatarFixture.ts", import.meta.url), "utf8");
    const names = [...source.matchAll(/export const (AVATAR_[A-Z_]*_FIXTURE) =/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(10);
    const start = source.indexOf("export function avatarFixtureRequested");
    const end = source.indexOf("\n}", start);
    const body = source.slice(start, end);
    const missing = names.filter((name) => !body.includes(name));
    // Every fixture mounted in the browser must advertise itself here: the
    // companion skips its day poll for fixtures, and a missed one makes the
    // bubble disappear a moment after it appears.
    expect(missing).toEqual([]);
  });
});
