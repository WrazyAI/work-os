import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

test("the Work OS root page is the In good company landing, not a placeholder", () => {
  const page = read("src/app/work-os/(site)/page.tsx");
  const landing = read("src/modules/work-os/marketing/LandingPage.tsx");
  assert.match(page, /<LandingPage\s*\/>/, "the route must render the landing component");
  assert.match(landing, /A little company\./);
  assert.match(landing, /A clearer workday\./);
  assert.match(landing, /Get Work OS/);
  assert.match(landing, /Actual desktop app · Demonstration data/);
  assert.equal((landing.match(/<h1/g) ?? []).length, 1, "exactly one h1");
  assert.doesNotMatch(landing, /lorem ipsum/i);
  assert.doesNotMatch(landing, /testimonial|trusted by|4\.9\/5/i);
});

test("the product theater uses current desktop captures and never autoplays", () => {
  const theater = read("src/modules/work-os/marketing/ProductTheater.tsx");
  assert.match(theater, /workspace-today\.webp/);
  assert.match(theater, /workspace-tasks\.webp/);
  assert.match(theater, /workspace-insights\.webp/);
  assert.match(theater, /aria-pressed/);
  assert.doesNotMatch(theater, /autoplay/i);
  assert.doesNotMatch(theater, /http:\/\/|https:\/\//, "product captures stay local");
});

test("the field guide does not advertise the old pilot duration or a false shared entry point", () => {
  const landing = read("src/modules/work-os/marketing/LandingPage.tsx");
  assert.doesNotMatch(landing, /25 seconds|Every film starts on the dashboard/);
});
