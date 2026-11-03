import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

test("the admin roster endpoint never returns deactivated people", async () => {
  const route = await source("src/app/api/work-os/people/route.ts");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
  assert.match(
    get,
    /eq\("active",\s*true\)/,
    "deactivating a person must remove them from the roster; without this filter active=false still lists",
  );
});

test("listPeople only returns active people", async () => {
  const lib = await source("src/lib/work-os.ts");
  const fn = lib.slice(lib.indexOf("export async function listPeople"), lib.indexOf("export async function updatePerson"));
  assert.match(fn, /eq\("active",\s*true\)/, "an unfiltered listPeople reintroduces departed people in admin pickers");
});
