import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Guards the mascot architecture: identity/renderers live in one config,
 * behavior is derived in one pure state layer, and product surfaces render
 * through MascotMark or MascotPet rather than importing Otto directly. */

const root = resolve(import.meta.dirname, "..");
const companion = resolve(root, "desktop/work-os-companion/src");
const read = (path: string) => readFileSync(resolve(companion, path), "utf8");

// --- config is the single source of identity/renderers ----------------------

const mascot = read("mascot.ts");
assert.match(mascot, /export const MASCOT = \{/);
assert.match(mascot, /Mark: StudioOtto/);
assert.match(mascot, /Pet: SpriteOtto/);
assert.match(mascot, /name: "Otto"/);
assert.match(mascot, /chatPose:/);
assert.match(mascot, /thinkingPose:/);
assert.match(mascot, /idlePose:/);
assert.match(mascot, /mark: "\/studio-otto-mark\.svg"/);
assert.match(mascot, /companion: "\/studio-otto\.svg"/);

const mascotMark = read("chat/MascotMark.tsx");
assert.match(mascotMark, /import \{ MASCOT,/);
assert.match(mascotMark, /const Mark = MASCOT\.Mark;/);
assert.match(mascotMark, /ariaLabel=\{`\$\{MASCOT\.name\}/);
assert.doesNotMatch(mascotMark, /from "\.\.\/Otto"/);
assert.match(mascotMark, /crop = MASCOT\.chatCrop/);
assert.match(mascotMark, /tone = "signal"/);

const mascotPet = read("MascotPet.tsx");
assert.match(mascotPet, /deriveMascotVisualState/);
assert.match(mascotPet, /const Pet = MASCOT\.Pet;/);
assert.match(mascotPet, /ariaLabel=\{`\$\{MASCOT\.name\}/);
assert.match(mascotPet, /data-activity=\{visual\.activity\}/);
assert.doesNotMatch(mascotPet, /from "\.\/Otto"/);
assert.doesNotMatch(mascotPet, /from "\.\/SignalSpirit"/);

const state = read("mascotState.ts");
assert.match(state, /export function deriveMascotVisualState/);
assert.doesNotMatch(state, /from "\.\/Otto"/);
assert.match(state, /agent === "working"/);
assert.match(state, /agent === "needs-input"/);
assert.match(state, /agent === "ready"/);

const mascotTypes = read("mascotTypes.ts");
assert.match(mascotTypes, /export type MascotCrop = "full" \| "head"/);
const spirit = read("StudioOtto.tsx");
assert.match(spirit, /head: "9 10 142 110"/);
assert.match(spirit, /data-pose=\{pose\}/);
assert.match(spirit, /data-tone=\{tone\}/);
assert.match(spirit, /studio-chassis/);
assert.match(spirit, /studio-head/);
assert.match(spirit, /studio-terminal-working/);
const studioMotion = read("studio-otto.css");
assert.match(studioMotion, /studio-work-rig/);
assert.match(studioMotion, /studio-attention-rig/);
assert.match(studioMotion, /studio-celebrate-rig/);
assert.match(studioMotion, /studio-recover-rig/);
assert.match(studioMotion, /steps\(5, end\)/);
assert.match(studioMotion, /prefers-reduced-motion: reduce/);
assert.match(mascotPet, /data-motion="renderer"/);
assert.doesNotMatch(mascotPet, /from "\.\/StudioOtto"/);
assert.match(mascot, /chatCrop: "head" as MascotCrop/);
const chatStyles = read("chat/chat.css");
assert.match(chatStyles, /\.chat-turn-mark \.chat-mascot-art \{/);

// --- product surfaces use abstractions -------------------------------------

const chatTurn = read("chat/ChatTurn.tsx");
assert.match(chatTurn, /import \{ MascotMark \} from "\.\/MascotMark"/);
assert.match(chatTurn, /<MascotMark/);
assert.doesNotMatch(chatTurn, /Sparkles/, "assistant turns must use the mascot, not a generic sparkle");

const thinking = read("AvatarThinking.tsx");
assert.match(thinking, /import \{ MascotMark \} from "\.\/chat\/MascotMark"/);
assert.doesNotMatch(thinking, /Sparkles/, "thinking traces represent the agent and must use the mascot");

const app = read("App.tsx");
assert.match(app, /import \{ MascotPet \} from "\.\/MascotPet"/);
assert.match(app, /<MascotPet/);
assert.doesNotMatch(app, /from "\.\/Otto"/);
assert.doesNotMatch(app, /<Otto\b/);

const lab = read("OttoPreview.tsx");
assert.match(lab, /MASCOT\.Mark pose=\{MASCOT\.idlePose\}/);
assert.doesNotMatch(lab, /<Otto pose="idle" style=\{\{ width: size/);

const avatar = read("AvatarApp.tsx");
assert.match(avatar, /import \{ MascotPet \} from "\.\/MascotPet"/);
assert.match(avatar, /useMascotRuntime/);
assert.match(avatar, /agentActivity/);
assert.match(avatar, /workdayState/);
assert.doesNotMatch(avatar, /from "\.\/Otto"/);
assert.doesNotMatch(avatar, /<Otto\b/);

// --- no stray hardcoded mascot art on speaking surfaces --------------------

for (const [name, source] of Object.entries({
  "chat/MascotMark.tsx": mascotMark,
  "chat/ChatTurn.tsx": chatTurn,
  "MascotPet.tsx": mascotPet,
  "App.tsx": app,
  "AvatarApp.tsx": avatar,
})) {
  for (const asset of ["work-os-companion.png", "work-os-mark.svg"]) {
    assert.ok(!source.includes(asset), `${name} hardcodes mascot asset ${asset}; route it through mascot.ts`);
  }
}

console.log("Mascot guard passed: Studio Otto identity, visual state, mark, and pet stay decoupled.");

const dashboard = read("DashboardSurface.tsx");
assert.doesNotMatch(dashboard, /from "\.\/Otto"/);
assert.doesNotMatch(dashboard, /<Otto\b/);
assert.match(dashboard, /<MascotPet/);
assert.match(app, /useMascotRuntime/);
assert.match(read("DebugWindow.tsx"), /<MascotDebugControls/);
assert.match(read("MascotPet.tsx"), /useMascotRuntimeSnapshot/);
