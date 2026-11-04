import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TUTORIALS, tutorialBySlug } from "../src/modules/work-os/tutorials.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the library keeps the ten short films and adds one extended Otto lesson", () => {
  assert.equal(TUTORIALS.length, 11);
  assert.equal(new Set(TUTORIALS.map((tutorial) => tutorial.slug)).size, TUTORIALS.length);
  for (const tutorial of TUTORIALS) {
    assert.ok(tutorial.steps.length >= 3, `${tutorial.slug} needs written steps`);
    assert.match(tutorial.summary, /\w/);
  }
});

test("the quick companion lesson and extended lesson cannot be confused", () => {
  assert.equal(tutorialBySlug("companion-chat")?.title, "Use Otto, the floating companion");
  const extended=tutorialBySlug("otto-extended");
  assert.ok(extended);
  assert.match(extended.title,/extended look/i);
  assert.ok(extended.steps.length>=8);
});

test("every published tutorial has its film, poster and captions on disk", () => {
  const published = TUTORIALS.filter((tutorial) => tutorial.status === "published");
  assert.ok(published.length >= 1, "the approved EOD pilot must be published");
  for (const tutorial of published) {
    const assets = [tutorial.video, tutorial.poster, tutorial.captions].filter((asset): asset is string => Boolean(asset));
    assert.equal(assets.length, 3, `${tutorial.slug} must name film, poster and captions`);
    for (const asset of assets) {
      assert.ok(existsSync(path.join(root, "public", asset)), `${tutorial.slug} is missing ${asset}`);
    }
  }
});

test("unknown tutorials and unpublished assets fail closed", () => {
  assert.equal(tutorialBySlug("not-real"), null);
  for (const tutorial of TUTORIALS.filter((item) => item.status === "in-production")) {
    assert.equal(tutorial.video, null);
  }
});

test("the player never autoplays or loops", () => {
  const source = readFileSync(path.join(root, "src/modules/work-os/marketing/TutorialPlayer.tsx"), "utf8");
  assert.doesNotMatch(source, /autoPlay|autoplay/);
  assert.doesNotMatch(source, /loop\b/);
  assert.match(source, /preload="none"/);
  assert.match(source, /kind="captions"/);
});
