#!/usr/bin/env node
/**
 * Shoot the tour guide films.
 *
 * Every first-visit page guide used to carry a hand-drawn inline SVG scene: an
 * abstract diagram of the page. A diagram can say *what* a page is for, but it
 * can never say *where* — so the guide is now film of the real companion,
 * captioned by the same three steps.
 *
 * This script is the camera department. It boots the companion's offline
 * playground (fixtures only, no backend contact, no writes anywhere), drives the
 * real controls with the real pointer, moves a real camera over the real layout,
 * and encodes a short clip per step.
 *
 * How a take is made — this is the part worth understanding before changing
 * anything here:
 *
 *   1. The shot list is *compiled* into a timeline: camera segments, pointer
 *      segments, holds, and the exact instants of presses and clicks. Every
 *      position in it is absolute, in page coordinates, resolved from the live
 *      layout rather than written as pixels.
 *   2. The take is *rendered* frame by frame. For each frame the shooter
 *      computes where the camera and pointer are at that instant, draws them,
 *      performs any click that has come due with real mouse input, and takes a
 *      screenshot.
 *   3. The frames are laid onto a constant frame rate and encoded.
 *
 * Nothing about the page's own clock is involved. An earlier version streamed
 * whatever the compositor produced, which quietly withheld frames whenever the
 * page went quiet: holds collapsed to nothing, camera moves lost their middles,
 * and two takes of the same shot never matched. Rendering each frame from an
 * explicit timeline removes that whole class of failure — and, because the
 * interface's own transitions are stilled, every frame is a settled state.
 *
 * Usage:
 *   node scripts/shoot-guide-films.mjs                 # every guide
 *   node scripts/shoot-guide-films.mjs day review      # only these guides
 *   node scripts/shoot-guide-films.mjs --keep-frames   # leave the raw frames
 */

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_SHOTS, MAX_SCALE } from "./film/shots.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const PUBLIC = resolve(APP, "public/guides");
const WORK = "/tmp/opencode/film-work";

/**
 * The real companion window, and the band of it the film frame sees. The window
 * is never resized: the interface lays out exactly as it does for an employee,
 * and only the captured band is narrowed.
 */
const VIEWPORT = { width: 1000, height: 960 };
const FRAME = { width: 1000, height: 500 };
/** Rendering above the delivered size keeps every zoom at native resolution. */
const SUPERSAMPLE = 2;
const OUTPUT_FPS = 30;
const QUALITY = 92;
const SETTLE_MS = 2600;
const RIPPLE_MS = 520;
const PRESS_MS = 120;
const LEAD_MS = 260;
const TAIL_MS = 420;

const args = process.argv.slice(2);
const keepFrames = args.includes("--keep-frames");
const wanted = args.filter((arg) => !arg.startsWith("--"));
const guides = (wanted.length ? wanted : Object.keys(GUIDE_SHOTS)).filter((id) => GUIDE_SHOTS[id]);

/**
 * Where the rig photographs the app. Defaults to the filming build (see
 * `vite.film.config.ts`); point it at the dev server to iterate on a shot.
 */
const FILM_BASE = (process.env.FILM_BASE ?? "http://localhost:1430").replace(/\/$/, "");

const ffprobe = (file, entries = "stream=width,height") =>
  execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0", file], { encoding: "utf8" }).trim();
const seconds = (file) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());

/* ────────────────────────────────────────────────────────────────────────────
 * Camera arithmetic
 * ──────────────────────────────────────────────────────────────────────── */

const cubicBezier = (p1x, p1y, p2x, p2y) => {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= (sampleX(t) - x) / slope;
    }
    return sampleY(t < 0 ? 0 : t > 1 ? 1 : t);
  };
};
/** The product's own easing, so the camera moves the way the interface does. */
const ease = cubicBezier(0.2, 0.8, 0.2, 1);

const lerp = (from, to, t) => from + (to - from) * t;

/** The page coordinate that puts the frame's top-left corner where we want it. */
async function resolveCamera(page, position, current) {
  const { fit, contain, fill = 0.9, anchor: wantedAnchor, scale: wantedScale, band = 0, left = 0, pad = 0 } = position;
  const boxOf = (selector) => page.evaluate((value) => window.__film.pageBox(value), selector);

  let scale = wantedScale ?? 1;
  let subject = null;
  if (fit || contain) {
    subject = await boxOf(fit ?? contain);
    if (!subject) throw new Error(`camera subject not found: ${fit ?? contain}`);
    // `fit` fills the frame's width with the subject; `contain` guarantees the
    // whole subject is inside it, which is what a dialog needs so its own
    // heading and controls are never cropped by the shot.
    const widthRatio = FRAME.width / subject.width;
    const heightRatio = FRAME.height / subject.height;
    const ratio = contain ? Math.min(widthRatio, heightRatio) : widthRatio;
    scale = Math.min(MAX_SCALE, Math.max(1, ratio * fill));
  }
  if (scale > MAX_SCALE + 1e-6) {
    throw new Error(`camera scale ${scale} exceeds MAX_SCALE ${MAX_SCALE}; the film would be magnified beyond native`);
  }
  // A fitted subject is centred until told otherwise: filling the frame with
  // something and then pushing it to one side is almost never the shot.
  const anchor = wantedAnchor ?? (subject ? "center" : "top");
  const halfW = FRAME.width / 2 / scale;
  const halfH = FRAME.height / 2 / scale;

  let top;
  let edge;
  if (subject) {
    if (anchor === "center") top = subject.cy - halfH;
    else if (anchor === "bottom") top = subject.bottom - halfH * 2;
    else top = subject.top;
    edge = subject.width > FRAME.width / scale ? subject.left : subject.cx - halfW;
  } else {
    if (typeof band === "number") top = band;
    else {
      const box = await boxOf(band);
      if (!box) throw new Error(`camera subject not found: ${band}`);
      if (anchor === "center") top = box.cy - halfH;
      else if (anchor === "bottom") top = box.bottom - halfH * 2;
      else top = box.top;
    }
    if (typeof left === "number") edge = left;
    else {
      const box = await boxOf(left);
      if (!box) throw new Error(`camera subject not found: ${left}`);
      edge = anchor === "center" ? box.cx - halfW : box.left;
    }
  }

  // Keep the frame inside the page. A subject near an edge cannot be centred
  // without filming empty canvas, so it is held slightly off-centre instead.
  const bounds = await page.evaluate(() => window.__film.bounds());
  const frameH = FRAME.height / scale;
  const frameW = FRAME.width / scale;
  top = Math.min(Math.max(0, top), Math.max(0, bounds.height - frameH));
  edge = Math.min(Math.max(0, edge), Math.max(0, bounds.width - frameW));

  return { scale, band: top + pad, left: edge };
}

/** Where a page coordinate lands on screen. The scroll cancels out of it. */
const screenFor = (pagePoint, camera) => ({
  x: (pagePoint.x - camera.left) * camera.scale,
  y: (pagePoint.y - camera.band) * camera.scale,
});

/* ────────────────────────────────────────────────────────────────────────────
 * Compiling a shot list into a timeline
 * ──────────────────────────────────────────────────────────────────────── */

async function compile(page, clip) {
  const segments = [];
  const events = [];
  let now = 0;

  const openCamera = await resolveCamera(page, clip.opening, { scale: 1, band: 0, left: 0 });
  segments.push({ kind: "cam", start: -1, end: 0, from: openCamera, to: openCamera });
  let camera = openCamera;
  // Where the pointer is resting as the clip opens. A selector keeps continuity
  // with the clip before it regardless of how the camera has moved since.
  let pointerPage = null;
  let pointerScreen = { x: 934, y: 452 };
  if (typeof clip.entry === "string") {
    const box = await page.evaluate((value) => window.__film.pageBox(value), clip.entry);
    if (box) pointerPage = { x: box.cx, y: box.cy };
  } else if (clip.entry) {
    pointerScreen = { x: clip.entry.x, y: clip.entry.y };
  }

  const hold = (ms) => {
    if (ms <= 0) return;
    segments.push({ kind: "hold", start: now, end: now + ms });
    now += ms;
  };

  hold(clip.hold ?? LEAD_MS);

  const aim = async (selector, { focus, dx = 0, dy = 0 } = {}) => {
    if (typeof selector === "object") {
      pointerPage = null;
      pointerScreen = { x: selector.x, y: selector.y };
      return;
    }
    const box = await page.evaluate((value) => window.__film.pageBox(value), selector);
    if (!box) throw new Error(`pointer target not found: ${selector}`);
    pointerPage = { x: box.cx, y: box.cy };
    void focus;
    void dx;
    void dy;
  };

  const approach = (ms) => {
    if (pointerPage === null || ms <= 0) return;
    const to = screenFor(pointerPage, camera);
    // The page anchor travels with the segment so the pointer keeps riding
    // whatever it is resting on after the approach has finished.
    segments.push({ kind: "pointer", start: now, end: now + ms, from: { ...pointerScreen }, to, page: pointerPage });
    now += ms;
    pointerScreen = to;
  };

  for (const [index, op] of clip.shots.entries()) {
    if (op.cam) {
      const ms = op.cam.ms ?? 1400;
      let to = null;
      try {
        to = await resolveCamera(page, op.cam, camera);
      } catch (error) {
        // A step may end on something the step itself creates — a dialog that
        // only exists after a click. Those targets are resolved during the take,
        // on the first frame of their segment, once the interaction that brings
        // them into being has actually happened.
        if (!/camera subject not found/.test(error.message)) throw error;
        segments.push({ kind: "cam", start: now, end: now + ms, from: { ...camera }, to: null, resolve: op.cam });
        now += ms;
        continue;
      }
      segments.push({ kind: "cam", start: now, end: now + ms, from: { ...camera }, to });
      now += ms;
      camera = to;
      // The pointer rides the camera, so its screen position is re-derived.
      if (pointerPage) pointerScreen = screenFor(pointerPage, camera);
      continue;
    }
    if (op.point !== undefined) {
      await aim(op.point, op);
      approach(op.ms ?? 820);
      continue;
    }
    if (op.click !== undefined) {
      await aim(op.click, op);
      approach(op.ms ?? 760);
      events.push({ kind: "press", at: now });
      events.push({ kind: "click", at: now + PRESS_MS, selector: op.click, index });
      hold(op.after ?? 900);
      continue;
    }
    if (op.hover !== undefined) {
      await aim(op.hover, op);
      approach(op.ms ?? 620);
      continue;
    }
    if (op.wait !== undefined) {
      hold(op.wait);
      continue;
    }
    throw new Error(`unknown shot op: ${JSON.stringify(op)}`);
  }

  hold(clip.tail ?? TAIL_MS);

  return {
    segments,
    events: events.sort((a, b) => a.at - b.at),
    totalMs: now,
    opening: openCamera,
    pointerStart: { page: pointerPage, screen: pointerScreen },
  };
}

/** The camera at an instant, with the same easing the compiler assumed. */
function cameraAt(timeline, at) {
  let last = timeline.opening;
  for (const segment of timeline.segments) {
    if (segment.kind !== "cam" || !segment.to) continue;
    if (at >= segment.end) {
      last = segment.to;
      continue;
    }
    if (at <= segment.start) return last;
    const t = (at - segment.start) / Math.max(1, segment.end - segment.start);
    const eased = ease(t);
    return {
      scale: lerp(segment.from.scale, segment.to.scale, eased),
      band: lerp(segment.from.band, segment.to.band, eased),
      left: lerp(segment.from.left, segment.to.left, eased),
    };
  }
  return last;
}

function pointerAt(timeline, at, camera) {
  const start = timeline.pointerStart;
  let last = start.page ? screenFor(start.page, camera) : start.screen;
  for (const segment of timeline.segments) {
    if (segment.kind !== "pointer") continue;
    if (at >= segment.end) {
      last = segment.page ? screenFor(segment.page, camera) : segment.to;
      continue;
    }
    if (at <= segment.start) break;
    const t = (at - segment.start) / Math.max(1, segment.end - segment.start);
    const eased = ease(t);
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const distance = Math.hypot(dx, dy);
    // A gentle bow, because a pointer that travels in a straight line looks
    // like a robot rather than a hand.
    const bow = Math.min(42, distance * 0.1) * Math.sin(Math.PI * eased);
    return {
      x: segment.from.x + dx * eased + (distance ? -dy / distance : 0) * bow,
      y: segment.from.y + dy * eased + (distance ? dx / distance : 0) * bow,
    };
  }
  return last;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Rendering a take
 * ──────────────────────────────────────────────────────────────────────── */

async function render(page, timeline, dir) {
  mkdirSync(dir, { recursive: true });
  const total = Math.max(2, Math.round((timeline.totalMs / 1000) * OUTPUT_FPS));
  let fired = 0;
  const clickResults = [];

  for (let frame = 0; frame < total; frame += 1) {
    const at = (frame / OUTPUT_FPS) * 1000;

    // Anything the shot list could not frame in advance — a dialog a click
    // brings into being — is measured here, once its moment has arrived.
    for (const segment of timeline.segments) {
      if (segment.kind !== "cam" || segment.to || !segment.resolve || at < segment.start) continue;
      segment.to = await resolveCamera(page, segment.resolve, segment.from);
    }

    const camera = cameraAt(timeline, at);

    // Perform any input that has come due, before the frame is drawn, so the
    // picture shows what the interface did about it.
    while (fired < timeline.events.length && timeline.events[fired].at <= at) {
      const event = timeline.events[fired];
      if (event.kind === "click") {
        const box = await page.evaluate((selector) => window.__film.box(selector), event.selector);
        if (!box) throw new Error(`click target vanished: ${event.selector}`);
        await page.mouse.move(box.cx, box.cy);
        await page.mouse.down();
        await page.mouse.up();
        clickResults.push({ step: event.index, selector: event.selector, at: Math.round(at) });
      }
      fired += 1;
    }

    const pointer = pointerAt(timeline, at, camera);
    const sincePress = timeline.events
      .filter((event) => event.kind === "press" && event.at <= at)
      .reduce((best, event) => Math.min(best, at - event.at), Infinity);
    const ripple = sincePress <= RIPPLE_MS ? sincePress : null;
    const pressed = sincePress <= PRESS_MS;

    await page.evaluate(
      (state) => window.__film.render(state),
      { scale: camera.scale, band: camera.band, left: camera.left, cursor: pointer, pressed, ripple },
    );
    // The clip is the film frame, in page coordinates. It is stated explicitly
    // rather than left to the emulated viewport, which narrows what the
    // compositor rasterises but does not change what a screenshot returns.
    await page.screenshot({
      path: resolve(dir, `f${String(frame).padStart(5, "0")}.jpg`),
      type: "jpeg",
      quality: QUALITY,
      clip: { x: 0, y: 0, width: FRAME.width, height: FRAME.height },
    });
  }
  if (clickResults.length !== timeline.events.filter((event) => event.kind === "click").length) {
    throw new Error("a scheduled click never fired");
  }
  return { frames: total, clicks: clickResults };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Capture
 * ──────────────────────────────────────────────────────────────────────── */

async function capture(browser, guideId, clipId, clip) {
  const dir = resolve(WORK, guideId, clipId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SUPERSAMPLE,
    reducedMotion: clip.reducedMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(String(error).slice(0, 160)));
  await page.addInitScript({ path: resolve(HERE, "film/crew.js") });

  await page.goto(`${FILM_BASE}/${(clip.url ?? "/?offline").replace(/^\//, "")}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".masthead", { timeout: 20000 });
  // Most shots are of a page other than the one the app boots on, so a clip may
  // name the destination it wants before the take starts.
  if (clip.nav) {
    await page.click(`button[data-sidebar-row][aria-label="${clip.nav}"]`);
    // Park the real pointer away from the rail: a collapsed sidebar shows a
    // tooltip under the cursor, and it would sit in shot for the whole take.
    await page.mouse.move(640, 900);
    await page.waitForTimeout(1200);
  }
  for (const selector of clip.await ?? []) await page.waitForSelector(selector, { timeout: 15000 });
  // Some controls have no stable class of their own. A clip can name them by the
  // label a person reads, and they are marked so the shot list can aim at them.
  for (const [name, label] of Object.entries(clip.tag ?? {})) {
    const target = page.getByRole("button", { name: label }).first();
    await target.evaluate((element, value) => element.setAttribute("data-film-target", value), name);
  }
  await page.waitForTimeout(SETTLE_MS);
  if (clip.before) await clip.before(page);
  await page.mouse.move(640, 900);
  await page.waitForTimeout(120);

  // Narrow what is captured to the film frame while leaving the window — and so
  // the layout — at its true size.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: SUPERSAMPLE,
    mobile: false,
    viewport: { x: 0, y: 0, width: FRAME.width, height: FRAME.height, scale: 1 },
  });
  await page.waitForTimeout(120);

  const timeline = await compile(page, clip);
  const take = await render(page, timeline, dir);

  // The rendered frame must be the film frame at the supersampled size, or the
  // encode is scaling something it did not mean to.
  const probe = ffprobe(resolve(dir, "f00000.jpg"));
  const expected = `${FRAME.width * SUPERSAMPLE},${FRAME.height * SUPERSAMPLE}`;
  if (probe !== expected) throw new Error(`rendered frames are ${probe}, expected ${expected}`);

  const staged = resolve(dir, "grid");
  mkdirSync(staged, { recursive: true });
  for (let slot = 0; slot < take.frames; slot += 1) {
    const name = `f${String(slot).padStart(5, "0")}.jpg`;
    try {
      linkSync(resolve(dir, name), resolve(staged, name));
    } catch {
      copyFileSync(resolve(dir, name), resolve(staged, name));
    }
  }

  mkdirSync(PUBLIC, { recursive: true });
  const out = resolve(PUBLIC, `${guideId}-${clipId}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-framerate", String(OUTPUT_FPS),
    "-i", resolve(staged, "f%05d.jpg"),
    "-vf", `scale=${FRAME.width}:${FRAME.height}:flags=lanczos`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
    "-g", String(OUTPUT_FPS * 2),
    "-movflags", "+faststart",
    out,
  ]);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", resolve(dir, "f00000.jpg"),
    "-vf", `scale=${FRAME.width}:${FRAME.height}:flags=lanczos`,
    "-q:v", "5",
    resolve(PUBLIC, `${guideId}-${clipId}.jpg`),
  ]);

  const duration = seconds(out);
  writeFileSync(resolve(dir, "timeline.json"), JSON.stringify({ totalMs: timeline.totalMs, clicks: take.clicks, problems }, null, 1));
  if (!keepFrames) rmSync(dir, { recursive: true, force: true });
  await context.close();

  return {
    id: `${guideId}-${clipId}`,
    guide: guideId,
    chapter: clipId,
    chapterTitle: clip.chapter,
    file: `guides/${guideId}-${clipId}.mp4`,
    poster: `guides/${guideId}-${clipId}.jpg`,
    duration: Number(duration.toFixed(2)),
    bytes: statSync(out).size,
    frames: take.frames,
    clicks: take.clicks.length,
    dims: ffprobe(out),
    problems,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entry
 * ──────────────────────────────────────────────────────────────────────── */

const browser = await chromium.launch();
const manifest = [];
let failed = false;

for (const guideId of guides) {
  for (const [clipId, clip] of Object.entries(GUIDE_SHOTS[guideId])) {
    process.stdout.write(`  ${guideId}/${clipId} … `);
    try {
      const result = await capture(browser, guideId, clipId, clip);
      manifest.push(result);
      const flags = result.problems.length ? `  ⚠ page errors: ${result.problems.slice(0, 2).join(" | ")}` : "";
      console.log(`${result.dims} ${result.duration}s ${(result.bytes / 1024).toFixed(0)}KB (${result.frames} frames, ${result.clicks} clicks)${flags}`);
    } catch (error) {
      failed = true;
      console.log(`FAILED: ${error.message}`);
    }
  }
}

await browser.close();

mkdirSync(WORK, { recursive: true });
const manifestPath = resolve(WORK, "manifest.json");

// Clip metadata accumulates across runs so a single guide can be re-shot
// without discarding what the others recorded.
let previous = [];
try {
  previous = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  previous = [];
}
const byId = new Map(previous.map((item) => [item.id, item]));
for (const item of manifest) byId.set(item.id, item);
const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(manifestPath, JSON.stringify(merged, null, 1));

// The film list the modal reads is generated from what was actually encoded, so
// durations and chapter labels cannot drift out of step with the footage.
execFileSync(process.execPath, [resolve(HERE, "write-guide-films.mjs"), manifestPath], { stdio: "inherit" });

const total = merged.reduce((sum, item) => sum + item.bytes, 0);
console.log(`\n${manifest.length} clips shot, ${(total / 1024 / 1024).toFixed(2)} MB across ${merged.length} clips on file`);
console.log(`manifest: ${manifestPath}`);
if (existsSync(PUBLIC)) console.log(`assets:   ${readdirSync(PUBLIC).length} files in ${PUBLIC}`);
process.exit(failed ? 1 : 0);
