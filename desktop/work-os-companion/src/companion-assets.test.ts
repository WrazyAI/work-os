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
    expect(css).toMatch(/\.mascot-connect\s*\{/);
    expect(css).not.toMatch(/mix-blend-mode:\s*screen/);
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain('from "./MascotPet"');
    expect(app).toContain('className="mascot-connect"');
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
    expect(avatarStyles).toMatch(/\.avatar-prompt-bubble span\s*\{[^}]*font-size:\s*10\.5px;/);
    expect(avatarStyles).toMatch(/\.avatar-drag-surface\s*\{[^}]*top:\s*22px;[^}]*left:\s*50%;[^}]*width:\s*52px;[^}]*height:\s*28px;[^}]*transform:\s*translateX\(-50%\);[^}]*background:\s*transparent;[^}]*font-size:\s*7px;/);
    expect(avatarStyles).toMatch(/\.avatar-drag-surface::before\s*\{[^}]*width:\s*36px;[^}]*height:\s*15px;[^}]*background:\s*rgba\(32, 36, 33, \.9\);/);
    expect(avatarStyles).toMatch(/\.avatar-hide\s*\{[^}]*top:\s*20px;[^}]*right:\s*9px;[^}]*width:\s*21px;[^}]*height:\s*21px;/);
    expect(avatarStyles).toMatch(/\.avatar-prompt-bubble ~ \.avatar-hide\s*\{[^}]*top:\s*72px;/);
    const conversationStyles = readFileSync(resolve(root, "src/chat/conversation.css"), "utf8");
    expect(conversationStyles).toMatch(/\.avatar-compact\s*\{[^}]*width:\s*200px;[^}]*height:\s*276px;/);
    expect(conversationStyles).toMatch(/\.avatar-orb\s*\{[^}]*width:\s*144px;[^}]*height:\s*154px;[^}]*margin:\s*76px 28px 0;/);
    expect(conversationStyles).toMatch(/\.avatar-drag-surface\s*\{[^}]*top:\s*22px;[^}]*left:\s*50%;[^}]*width:\s*52px;[^}]*height:\s*28px;[^}]*transform:\s*translateX\(-50%\);[^}]*background:\s*transparent;[^}]*font-size:\s*7px;/);
    expect(conversationStyles).toMatch(/\.avatar-drag-surface::before\s*\{[^}]*width:\s*36px;[^}]*height:\s*15px;[^}]*background:\s*rgba\(32, 36, 33, 0\.9\);/);
    expect(conversationStyles).toMatch(/\.avatar-prompt-bubble ~ \.avatar-orb\s*\{[^}]*margin-top:\s*108px;/);
    const accessibilityStyles = readFileSync(resolve(root, "src/accessibility.css"), "utf8");
    expect(accessibilityStyles).toMatch(/html\[data-mascot-size="small"\] \.avatar-compact \.avatar-drag-surface\s*\{[^}]*top:\s*47px;/);
    expect(accessibilityStyles).toMatch(/html\[data-mascot-size="small"\] \.avatar-compact \.avatar-prompt-bubble \+ \.avatar-drag-surface\s*\{[^}]*top:\s*97px;/);
    expect(accessibilityStyles).toMatch(/html\[data-mascot-size="small"\] \.avatar-compact \.avatar-hide\s*\{[^}]*top:\s*45px;/);
    expect(accessibilityStyles).toMatch(/html\[data-mascot-size="small"\] \.avatar-compact \.avatar-prompt-bubble ~ \.avatar-hide\s*\{[^}]*top:\s*97px;/);
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
});
