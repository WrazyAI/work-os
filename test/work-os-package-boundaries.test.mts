import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_ROOT = path.join(REPO_ROOT, "packages/work-os-shared");
const COMPANION_SRC = path.join(REPO_ROOT, "desktop/work-os-companion/src");

function walkCodeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkCodeFiles(full, out);
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

test("companion code imports shared domain logic via @wrazy/work-os-shared, never ../../../src/", () => {
  const violations: string[] = [];
  const relativeSrcImport = /^\s*(?:import|export)\b[^;\n]*from\s+["'](?:\.\.\/)+src\//m;

  for (const file of walkCodeFiles(COMPANION_SRC)) {
    const text = readFileSync(file, "utf8");
    if (relativeSrcImport.test(text)) {
      violations.push(path.relative(REPO_ROOT, file));
    }
  }

  assert.deepEqual(
    violations,
    [],
    `companion files must import from @wrazy/work-os-shared/* instead of climbing into ../../../src/: ${violations.join(", ")}`,
  );
});

test("packages/work-os-shared stays dependency-free and free of server-only imports", () => {
  const sharedPkg = JSON.parse(readFileSync(path.join(SHARED_ROOT, "package.json"), "utf8"));
  assert.equal(sharedPkg.name, "@wrazy/work-os-shared");
  assert.equal(sharedPkg.dependencies, undefined, "shared package must remain zero-dependency");

  for (const [subpath, target] of Object.entries(sharedPkg.exports as Record<string, string>)) {
    assert.ok(existsSync(path.join(SHARED_ROOT, target)), `export ${subpath} -> ${target} must exist`);
  }

  const forbidden = /(?:from|import)\s+["'](?:node:|pg\b|next\/|@\/|better-auth|@aws-sdk)/;
  const violations: string[] = [];
  for (const file of walkCodeFiles(path.join(SHARED_ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    if (forbidden.test(text)) {
      violations.push(path.relative(REPO_ROOT, file));
    }
  }
  assert.deepEqual(violations, [], `shared package must not import server-only modules: ${violations.join(", ")}`);
});
