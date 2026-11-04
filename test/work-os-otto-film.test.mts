import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const fixturesUrl = new URL("../scripts/tutorial-film/otto-fixtures.mjs", import.meta.url);
const storyUrl = new URL("../scripts/tutorial-film/otto-story.mjs", import.meta.url);

test("the extended film has an executable isolated API fixture", () => {
  assert.ok(existsSync(fixturesUrl), "missing isolated Otto film API adapter");
});

test("eight paired parts keep conversation before reminders and preserve real decisions", async () => {
  assert.ok(existsSync(storyUrl), "missing executable eight-part shot list");
  const { ottoParts, validateOttoTake } = await import(storyUrl.href);
  assert.equal(ottoParts.length, 8);
  assert.deepEqual(ottoParts.slice(0, 3).map((p: any) => p.id), ["workday", "unfinished", "agenda"]);
  for (const part of ottoParts) {
    assert.deepEqual(part.scenes.map((s: any) => s.surface), ["floating", "app"]);
    assert.doesNotMatch(part.title, /chapter/i);
    assert.ok(part.scenes.every((s: any) => s.actions.length));
  }
  assert.throws(() => validateOttoTake({ preflight: true }), /preflight/);
  assert.throws(() => validateOttoTake({ preflight: false, parts: [], backendCalls: [] }), /eight/);
});

test("workday questions return grounded read-only answers and unknown inputs fail closed", async () => {
  assert.ok(existsSync(fixturesUrl));
  const { createOttoFilmApi } = await import(fixturesUrl.href);
  const api = createOttoFilmApi();
  const before = api.snapshot();
  const answer = api.handle("POST", "/api/work-os/me/interpret", { input: "Summarize my workday so far." });
  assert.match(answer.interpretation.reply, /recovery|checklist/i);
  assert.deepEqual(answer.interpretation.operations, []);
  assert.deepEqual(api.snapshot(), before);
  assert.throws(() => api.handle("POST", "/api/work-os/me/interpret", { input: "Delete everyone's tasks" }), /Unsupported demo question/);
  assert.throws(() => api.handle("GET", "/api/work-os/admin/people"), /Unfixture/);
});

test("yesterday EOD question never fabricates a historical submission-status answer", async () => {
  assert.ok(existsSync(fixturesUrl));
  const { createOttoFilmApi } = await import(fixturesUrl.href);
  const api = createOttoFilmApi();
  const answer = api.handle("POST", "/api/work-os/me/interpret", { input: "Did I submit an EOD report yesterday?" });
  assert.match(answer.interpretation.reply, /check|verify/i);
  assert.doesNotMatch(answer.interpretation.reply, /\byes\b|you submitted|you did not/i);
  assert.equal(answer.interpretation.operations[0].page, "review");
});

test("recap confirmation never completes work and every suggestion needs its own decision", async () => {
  assert.ok(existsSync(fixturesUrl));
  const { createOttoFilmApi } = await import(fixturesUrl.href);
  const api = createOttoFilmApi({ phase: "recap" });
  const before = api.snapshot().tasks;
  api.handle("POST", "/api/work-os/me/activity-intervals/film-recap/decision", { action: "confirm" });
  assert.deepEqual(api.snapshot().tasks, before);
  const suggestions = api.handle("GET", "/api/work-os/me/activity-intervals/film-recap/next-steps");
  assert.equal(suggestions.items.length, 3);
  api.handle("PATCH", "/api/work-os/proposals/film-complete", { decision: "accept" });
  assert.equal(api.snapshot().tasks.find((t: any) => t.id === "film-recovery").completed, true);
  assert.equal(api.snapshot().proposals["film-create"], "pending");
  api.handle("PATCH", "/api/work-os/proposals/film-create", { decision: "accept", edits: { name: "Publish the recovery checklist" } });
  assert.ok(api.snapshot().tasks.some((t: any) => t.title === "Publish the recovery checklist"));
  api.handle("PATCH", "/api/work-os/proposals/film-subtask", { decision: "reject" });
  assert.equal(api.snapshot().proposals["film-subtask"], "rejected");
});

test("finishing rejects silent speech scenes and derives chapter starts from actual video durations", async () => {
  const url = new URL("../scripts/tutorial-film/otto-finish.mjs", import.meta.url);
  assert.ok(existsSync(url), "missing extended-film finalizer");
  const { buildOttoTimeline } = await import(url.href);
  const { ottoParts } = await import(storyUrl.href);
  const parts = ottoParts.map((part: any) => ({
    id: part.id, title: part.title, preflight: false, backendCalls: [], errors: [],
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
  const timeline = buildOttoTimeline(parts);
  assert.equal(timeline.duration,160);
  assert.deepEqual(timeline.chapters.map((c:any)=>c.start),[0,20,40,60,80,100,120,140]);
  assert.deepEqual(timeline.speech.map((s:any)=>s.at),[61,71]);
  const silent=structuredClone(parts);silent[3].scenes[0].speech=[];
  assert.throws(()=>buildOttoTimeline(silent),/audible/);
  const preflight=structuredClone(parts);preflight[0].preflight=true;
  assert.throws(()=>buildOttoTimeline(preflight),/preflight/);
  const prepared=structuredClone(parts) as Array<(typeof parts)[number] & {scenes: Array<(typeof parts)[number]["scenes"][number] & {preparation?: string}>}>;
  prepared[4].scenes[0].preparation='The prior part already read this recap.';
  prepared[4].scenes[0].speech=[{at:12,duration:18,source:'voices/warm.mp3'}];
  assert.equal(buildOttoTimeline(prepared).speech.length,2,'pre-capture preparation speech is not mixed into the film');
});

test("the filming fingerprint changes when styling or the spoken bytes change", async () => {
  const url=new URL("../scripts/tutorial-film/otto-provenance.mjs",import.meta.url);
  assert.ok(existsSync(url),"missing complete filming-build fingerprint");
  const { fingerprintBuild }=await import(url.href);
  const dir=mkdtempSync(join(tmpdir(),'otto-fingerprint-'));
  try {
    writeFileSync(join(dir,'index.html'),'<main>demo</main>');
    writeFileSync(join(dir,'style.css'),'body{color:black}');
    writeFileSync(join(dir,'voice.mp3'),Buffer.from([1,2,3]));
    const initial=fingerprintBuild(dir);
    writeFileSync(join(dir,'style.css'),'body{color:white}');
    assert.notEqual(fingerprintBuild(dir),initial);
    const restyled=fingerprintBuild(dir);
    writeFileSync(join(dir,'voice.mp3'),Buffer.from([3,2,1]));
    assert.notEqual(fingerprintBuild(dir),restyled);
    assert.equal(fingerprintBuild(dir),fingerprintBuild(dir));
  } finally {rmSync(dir,{recursive:true});}
});
