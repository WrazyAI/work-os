import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mapWithConcurrency } from "../src/lib/work-os-screenshots";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("the window analysis keeps frames in flight instead of one at a time", async () => {
  let inFlight = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6];
  const results = await mapWithConcurrency(items, 3, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight -= 1;
    return item * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12], "results keep the order of the input");
  assert.ok(peak > 1, "items must run concurrently");
  assert.ok(peak <= 3, "no more items may run at once than the limit allows");
});

test("a failing item does not take the whole batch down", async () => {
  const results = await mapWithConcurrency([1, 2, 3], 3, async (item) => {
    if (item === 2) throw new Error("frame analysis failed");
    return item;
  });
  assert.deepEqual(results, [1, null, 3]);
});

test("the limit never exceeds the number of items", async () => {
  let peak = 0;
  let inFlight = 0;
  await mapWithConcurrency([1, 2], 8, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return item;
  });
  assert.equal(peak, 2);
});

test("the screenshot window analyses its frames concurrently", async () => {
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /mapWithConcurrency\(sampleScreenshots\(pending, maxFrames\)/);
  assert.doesNotMatch(
    lib,
    /for \(const log of sampleScreenshots\(pending, maxFrames\)\)/,
    "frames must not be analysed one after another",
  );
});

test("the scheduled day run analyses its frames concurrently", async () => {
  const lib = await source("src/lib/work-os-screenshots.ts");
  assert.match(lib, /mapWithConcurrency\(sampled, SCREENSHOT_ANALYSIS_CONCURRENCY/);
  assert.doesNotMatch(
    lib,
    /for \(const log of sampleScreenshots\(pending, maxScreenshots\)\)/,
    "a day's frames must not be analysed one after another",
  );
});
