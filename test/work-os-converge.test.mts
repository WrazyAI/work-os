import assert from "node:assert/strict";
import { classifyConvergence, matchesExclude } from "../scripts/converge-to-agentos.mts";

/** Guards the work-os → agent-os convergence classifier: only files whose
 * target pre-image matches the source pre-image exactly may be auto-applied.
 * Diverged, new, absent, and deleted files always need manual review. */

const sourcePre: Record<string, string> = {
  "src/lib/one.ts": "pre-1",
  "src/lib/two.ts": "pre-2",
  "docs/old.md": "pre-old",
};
const sourcePost: Record<string, string> = {
  "src/lib/one.ts": "post-1",
  "src/lib/two.ts": "post-2",
  "docs/old.md": "post-old",
  "docs/new.md": "post-new",
};
const target: Record<string, string> = {
  "src/lib/one.ts": "pre-1",
  "src/lib/two.ts": "other",
};

const comparisons = classifyConvergence({
  files: ["src/lib/one.ts", "src/lib/two.ts", "docs/old.md", "docs/new.md"],
  sourcePre: (path) => sourcePre[path] ?? null,
  sourcePost: (path) => sourcePost[path] ?? null,
  target: (path) => target[path] ?? null,
});
assert.deepEqual(comparisons, [
  { path: "src/lib/one.ts", status: "identical" },
  { path: "src/lib/two.ts", status: "diverged" },
  { path: "docs/old.md", status: "absent" },
  { path: "docs/new.md", status: "new" },
]);

assert.deepEqual(
  classifyConvergence({ files: ["docs/gone.md"], sourcePre: () => "pre", sourcePost: () => null, target: () => "pre" }),
  [{ path: "docs/gone.md", status: "deleted" }],
);

assert.deepEqual(
  classifyConvergence({ files: ["docs/new.md"], sourcePre: () => null, sourcePost: () => "post", target: () => "other" }),
  [{ path: "docs/new.md", status: "diverged" }],
);

assert.ok(matchesExclude("scripts/converge-to-agentos.mts", ["scripts/converge-to-agentos.mts"]));
assert.ok(matchesExclude("src/nested/b.ts", ["src/*"]), "dir/* is a prefix rule");
assert.ok(!matchesExclude("src/a.ts", ["docs/*"]));
assert.ok(!matchesExclude("src/a.ts", ["src/a.ts.bak"]));
