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

  it("composites Otto over dark UI without screen blending", () => {
    const css = readFileSync(resolve(root, "src/otto.css"), "utf8");
    expect(css).toMatch(/\.otto-connect\s*\{/);
    expect(css).not.toMatch(/mix-blend-mode:\s*screen/);
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).toContain('from "./Otto"');
    expect(app).toContain('className="otto-connect"');
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
    expect(avatarWindow).toMatchObject({ width: 164, height: 188, resizable: false });
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
    expect(avatar).toContain("avatar-close-hide");
    expect(avatar).toContain("avatar-head-actions");
    expect(avatar).toContain("nextAgendaAutoExpand");
    expect(avatar).toContain('from "lucide-react"');
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
    // The avatar reads the shared cached day query instead of its own fetch.
    expect(avatar).toContain('workOsKeys.day("compact")');
    expect(avatar).toContain('fetchDay({ variant: "compact" })');
    expect(avatar).not.toContain('"/api/work-os/me/day", { method: "POST"');
    expect(avatar).toContain('"work-os://main-day-changed"');
    expect(avatar).toContain("facts.taskOptions");
    expect(avatar).toContain("ApprovalFlow");
    expect(avatar).toContain("avatar-drag-surface");
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
});
