import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Guards the agent-mascot contract: the mascot's identity and art live in one
 * config, and no chat surface hardcodes a substitute (the Sparkles icon stood in
 * for the agent before). A global mascot change must only touch mascot.ts. */

const root = resolve(import.meta.dirname, "..");
const companion = resolve(root, "desktop/work-os-companion/src");
const read = (path: string) => readFileSync(resolve(companion, path), "utf8");

// --- the config is the single source of truth -------------------------------

const mascot = read("mascot.ts");
assert.match(mascot, /export const MASCOT = \{/);
assert.match(mascot, /Mark: Otto/);
assert.match(mascot, /name: "Otto"/);
assert.match(mascot, /chatPose:/);
assert.match(mascot, /thinkingPose:/);
assert.match(mascot, /idlePose:/);

// MascotMark must render the configured component, not a hardcoded one.
const mascotMark = read("chat/MascotMark.tsx");
assert.match(mascotMark, /import \{ MASCOT \} from "\.\.\/mascot"/);
assert.match(mascotMark, /const Mark = MASCOT\.Mark;/);
assert.doesNotMatch(mascotMark, /work-os-companion\.png|work-os-mark\.svg/);
// The chat mark uses the configured head crop, and the badge owns the art size.
assert.match(mascotMark, /crop = MASCOT\.chatCrop/);
assert.match(mascotMark, /crop=\{crop\}/);
const otto = read("Otto.tsx");
assert.match(otto, /export type OttoCrop = "full" \| "head"/);
assert.match(otto, /head: "20 12 56 56"/);
assert.match(mascot, /chatCrop: "head" as OttoCrop/);
const chatStyles = read("chat/chat.css");
assert.match(chatStyles, /\.chat-turn-mark \.chat-mascot-art \{/);

// --- the agent surfaces use it ----------------------------------------------

const chatTurn = read("chat/ChatTurn.tsx");
assert.match(chatTurn, /import \{ MascotMark \} from "\.\/MascotMark"/);
assert.match(chatTurn, /<MascotMark/);
assert.doesNotMatch(chatTurn, /Sparkles/, "the assistant turn mark must be the mascot, not a sparkle");

const thinking = read("AvatarThinking.tsx");
assert.match(thinking, /import \{ MascotMark \} from "\.\/chat\/MascotMark"/);
assert.doesNotMatch(thinking, /Sparkles/, "the thinking trace represents the agent and must use the mascot");

const app = read("App.tsx");
assert.match(app, /import \{ MascotMark \} from "\.\/chat\/MascotMark"/);
assert.match(app, /<MascotMark pose=\{MASCOT\.idlePose\} \/>/, "the composer welcome must greet with the mascot");

const avatar = read("AvatarApp.tsx");
assert.match(avatar, /import \{ Otto \} from "\.\/Otto"/);

// --- no stray hardcoded mascot art ------------------------------------------

const assetFiles = ["mascot.ts", "Otto.tsx"];
for (const [name, source] of Object.entries({
  "chat/MascotMark.tsx": mascotMark,
  "chat/ChatTurn.tsx": chatTurn,
  "App.tsx": app,
})) {
  for (const asset of ["work-os-companion.png", "work-os-mark.svg"]) {
    assert.ok(
      assetFiles.includes(name) || !source.includes(asset),
      `${name} hardcodes the mascot asset ${asset}; import it from mascot.ts instead`,
    );
  }
}

console.log("Mascot guard passed: config in mascot.ts, chat surfaces use MascotMark.");
