import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a chosen chapter keeps focus in the list and announces the seek without forcing play", () => {
  const source = readFileSync(new URL("../src/modules/work-os/marketing/TutorialPlayer.tsx", import.meta.url), "utf8");
  assert.match(source, /seekTutorialChapter\(player\.current, chapter\.start\)/);
  assert.doesNotMatch(source, /\.focus\(/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /Starting part/);
  assert.ok(source.indexOf("<figcaption") > source.indexOf("<nav"), "the figcaption must be the figure's last child");
  assert.doesNotMatch(source, /\.play\(\)/);
  assert.doesNotMatch(source, /autoPlay|autoplay/);
});
