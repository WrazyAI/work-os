import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = (relative: string) => createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex");

test("the site companion is the configured mascot, not a second identity", () => {
  assert.ok(existsSync(path.join(root, "src/modules/work-os/marketing/Companion.tsx")));
  assert.equal(
    hash("public/work-os/studio-otto.svg"),
    hash("desktop/work-os-companion/public/studio-otto.svg"),
    "the published mascot must byte-match the companion source",
  );
});

test("the companion celebrates only on click and respects reduced motion", () => {
  const source = readFileSync(path.join(root, "src/modules/work-os/marketing/Companion.tsx"), "utf8");
  assert.match(source, /data-state/);
  assert.match(source, /prefers-reduced-motion|reduced/);
  assert.match(source, /onClick/);
  assert.doesNotMatch(source, /setInterval\([^)]*celebrat/i, "celebration must never run on a timer");
  assert.doesNotMatch(source, /autoplay/i);
});
