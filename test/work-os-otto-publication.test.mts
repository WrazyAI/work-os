import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { TUTORIALS, tutorialBySlug } from "../src/modules/work-os/tutorials.ts";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("the field guide counts the extended lesson and does not misstate where every film starts", () => {
  const page = read("src/app/work-os/(site)/tutorials/page.tsx");
  assert.doesNotMatch(page, /Ten short films/);
  assert.doesNotMatch(page, /Every film starts on the dashboard/);
  assert.match(page, /extended/i);
  assert.match(page, /eleven/i);
  const metadata = page.match(/description: "([^"]+)"/)?.[1] ?? "";
  assert.match(metadata, /extended|task-specific/i);
});

test("long film durations read as minutes rather than a rounded 200 seconds", async () => {
  const url = new URL("../src/modules/work-os/tutorial-duration.ts", import.meta.url);
  assert.ok(existsSync(url), "missing shared duration formatter");
  const { formatTutorialDuration } = await import(url.href);
  assert.equal(formatTutorialDuration(199.684), "3:19");
  assert.equal(formatTutorialDuration(55.4), "55s");
  assert.equal(formatTutorialDuration(60), "1:00");
  assert.equal(formatTutorialDuration(null), "25s");
  const library = read("src/modules/work-os/marketing/TutorialLibrary.tsx");
  const player = read("src/modules/work-os/marketing/TutorialPlayer.tsx");
  assert.match(library, /formatTutorialDuration/);
  assert.match(player, /formatTutorialDuration/);
});

test("spoken captions use the shipped voice's measured line starts, including a cut-off in-app read", async () => {
  const url = new URL("../scripts/tutorial-film/otto-finish.mjs", import.meta.url);
  const { spokenCues } = await import(url.href);
  const full = spokenCues({ at: 10, duration: 17.919 });
  assert.deepEqual(full.map((cue: { start: number }) => Number(cue.start.toFixed(3))), [10, 14.344, 17.274, 21.947, 25.016]);
  assert.equal(Number(full.at(-1).end.toFixed(3)), 27.919);
  const cut = spokenCues({ at: 0, duration: 5.941 });
  assert.ok(cut.every((cue: { end: number }) => cue.end <= 5.941001));
  assert.ok(cut.filter((cue: { end: number; start: number }) => cue.end - cue.start > 0.4).length >= 1);
  assert.equal(cut.length, 2, "only the lines the clip actually reaches");
  for (const cue of [...full, ...cut]) assert.ok(cue.text.trim().length > 0);
});

test("published chapter offsets equal the committed render timeline", async () => {
  const artifact = new URL("../scripts/tutorial-film/otto-extended.timeline.json", import.meta.url);
  assert.ok(existsSync(artifact), "missing the measured timeline used to render the film");
  const timeline = JSON.parse(readFileSync(artifact, "utf8"));
  const lesson = tutorialBySlug("otto-extended");
  assert.ok(lesson);
  assert.ok(Math.abs(Number(timeline.duration) - lesson.duration!) < 0.001, "duration follows the render");
  assert.deepEqual(lesson.chapters?.map((chapter) => Number(chapter.start.toFixed(6))), timeline.chapters.map((chapter: { start: number }) => Number(chapter.start.toFixed(6))));
  assert.equal(TUTORIALS.filter((item) => item.status === "published").length, 11);
});

test("the shot list protects every approved decision and the capture gate enforces it", async () => {
  const url = new URL("../scripts/tutorial-film/otto-story.mjs", import.meta.url);
  const { ottoParts, validateOttoTake } = await import(url.href);
  const evidence = ottoParts.map((part: any) => ({
    id: part.id,
    title: part.title,
    preflight: false,
    backendCalls: [],
    errors: [],
    scenes: part.scenes.map((scene: any) => ({
      surface: scene.surface,
      videoDuration: 10,
      speech: part.id === "listen" ? [{ at: 1, duration: 3, source: "voices/warm.mp3" }] : [],
      actions: scene.actions.flatMap((action: any) => action.type === "assert"
        ? [{ type: "assert", text: action.text }]
        : action.type === "suggestions"
          ? ["Mark done", "Edit new task", "Save title / Add task", "Add task", "Skip remaining suggestion"].map((label) => ({ type: "click", label }))
          : action.type === "olderReview"
            ? ["Earlier recap: Extra notes", "Earlier recap: close notes", "Earlier recap: Looks right"].map((label) => ({ type: "click", label }))
          : [{ type: action.type, label: action.name ?? action.selector ?? action.type }]),
    })),
  }));
  assert.doesNotThrow(() => validateOttoTake({ parts: evidence, backendCalls: [], errors: [] }));
  const dropped = structuredClone(evidence);
  const droppedEod = dropped.find((part: any) => part.id === "eod");
  for (const scene of droppedEod.scenes) scene.actions = scene.actions.filter((action: any) => action.label !== "Submit EOD");
  assert.throws(() => validateOttoTake({ parts: dropped, backendCalls: [], errors: [] }), /Submit EOD/);
  const noEarlier = structuredClone(evidence);
  const eodApp = noEarlier.find((part: any) => part.id === "eod").scenes[1];
  eodApp.actions = eodApp.actions.filter((action: any) => action.text !== "Earlier days");
  assert.throws(() => validateOttoTake({ parts: noEarlier, backendCalls: [], errors: [] }), /Earlier days/);
});

test("the player keeps the figcaption last and leaves focus with the chapter button", () => {
  const player = read("src/modules/work-os/marketing/TutorialPlayer.tsx");
  const nav = player.indexOf("<nav");
  const caption = player.indexOf("<figcaption");
  assert.ok(nav > 0 && caption > nav, "the figcaption must remain the figure's last child");
  assert.doesNotMatch(player, /\.focus\(/);
  assert.match(player, /aria-live="polite"/);
  assert.match(player, /Starting part/);
});
