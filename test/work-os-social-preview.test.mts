import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isWorkOsSitePath } from "../src/modules/work-os/marketing/site.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

test("public Work OS landing has distinct metadata and a public OG image", () => {
  const layout = read("src/app/work-os/(site)/layout.tsx");
  const image = read("src/app/work-os/(site)/opengraph-image.tsx");
  assert.match(layout, /Work OS by Wrazy/);
  assert.match(layout, /openGraph:\s*\{/);
  assert.match(layout, /twitter:\s*\{/);
  assert.match(layout, /canonical:\s*"\/work-os"/);
  assert.match(layout, /\/work-os\/opengraph-image/);
  assert.match(image, /ImageResponse/);
  assert.match(image, /width:\s*1200/);
  assert.match(image, /height:\s*630/);
  assert.equal(isWorkOsSitePath("/work-os/opengraph-image"), true);
  assert.equal(isWorkOsSitePath("/work-os/workspace"), false);
});

test("Work OS downloads uses route-specific sharing metadata", () => {
  const downloads = read("src/app/work-os/(site)/downloads/page.tsx");
  assert.match(downloads, /Download Work OS by Wrazy/);
  assert.match(downloads, /canonical:\s*"\/work-os\/downloads"/);
  assert.match(downloads, /\/work-os\/opengraph-image/);
});
