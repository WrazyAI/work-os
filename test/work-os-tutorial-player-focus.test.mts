import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a chosen chapter moves keyboard focus to the real player without forcing play", () => {
  const source = readFileSync(new URL("../src/modules/work-os/marketing/TutorialPlayer.tsx", import.meta.url), "utf8");
  assert.match(source, /seekTutorialChapter\(player\.current, chapter\.start\)/);
  assert.match(source, /player\.current\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(source, /\.play\(\)/);
  assert.doesNotMatch(source, /autoPlay|autoplay/);
});
