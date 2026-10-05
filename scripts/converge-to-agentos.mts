import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type ConvergenceStatus = "identical" | "diverged" | "new" | "deleted" | "absent";

export interface FileComparison {
  path: string;
  status: ConvergenceStatus;
}

export function classifyConvergence(input: {
  files: string[];
  sourcePre: (path: string) => string | null;
  sourcePost: (path: string) => string | null;
  target: (path: string) => string | null;
}): FileComparison[] {
  return input.files.map((path) => {
    const pre = input.sourcePre(path);
    const post = input.sourcePost(path);
    const target = input.target(path);
    let status: ConvergenceStatus;
    if (post === null) status = "deleted";
    else if (pre === null) status = target === null ? "new" : "diverged";
    else if (target === null) status = "absent";
    else if (target === pre) status = "identical";
    else status = "diverged";
    return { path, status };
  });
}

export function matchesExclude(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
  );
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }).trim();
}

function blob(rev: string, path: string, cwd: string): string | null {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${rev}:${path}`], cwd) || null;
  } catch {
    return null;
  }
}

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const includeNew = argv.includes("--include-new");
  const strict = argv.includes("--strict");
  const noFetch = argv.includes("--no-fetch");
  const remote = readFlag(argv, "--remote") ?? "agentos";
  const baseFlag = readFlag(argv, "--base");
  const message = readFlag(argv, "--message");
  const flagsWithValues = new Set(["--remote", "--base", "--message", "--exclude"]);
  const flagValues = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    if (flagsWithValues.has(argv[index]) && argv[index + 1]) flagValues.add(argv[index + 1]);
  }
  const commitArg = argv.find((arg) => !arg.startsWith("--") && !flagValues.has(arg));
  const excludes: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--exclude" && argv[index + 1]) excludes.push(argv[index + 1]);
  }

  const repo = git(["rev-parse", "--show-toplevel"]);
  try {
    git(["remote", "get-url", remote], repo);
  } catch {
    throw new Error(`remote "${remote}" is not configured in ${repo} (add it or pass --remote)`);
  }
  if (!noFetch) git(["fetch", remote], repo);

  const commit = git(["rev-parse", `${commitArg ?? `${remote}/main`}^{commit}`], repo);
  const parents = git(["rev-list", "--parents", "-n", "1", commit], repo).split(" ");
  let base: string;
  if (baseFlag) base = git(["rev-parse", `${baseFlag}^{commit}`], repo);
  else if (parents.length === 2) base = parents[1];
  else throw new Error(`commit ${commit.slice(0, 7)} has ${parents.length - 1} parents; pass --base <rev>`);

  const targetRef = `${remote}/main`;
  const targetSha = git(["rev-parse", targetRef], repo);
  const files = git(["diff", "--name-only", base, commit], repo).split("\n").filter(Boolean);
  const comparisons = classifyConvergence({
    files,
    sourcePre: (path) => blob(base, path, repo),
    sourcePost: (path) => blob(commit, path, repo),
    target: (path) => blob(targetRef, path, repo),
  });

  const autoStatuses = new Set<ConvergenceStatus>([
    "identical",
    ...(includeNew ? (["new"] as ConvergenceStatus[]) : []),
  ]);
  const selected = comparisons.filter(
    (entry) => autoStatuses.has(entry.status) && !matchesExclude(entry.path, excludes),
  );
  const skipped = comparisons.filter((entry) => !selected.includes(entry));

  console.log(`converge ${commit.slice(0, 7)} → ${remote}/main (${targetSha.slice(0, 7)}): ${comparisons.length} file(s)`);
  for (const entry of comparisons) {
    console.log(`  ${selected.includes(entry) ? "→ apply" : "  skip "} ${entry.status.padEnd(9)} ${entry.path}`);
  }
  if (skipped.length) {
    console.log(`note: ${skipped.length} file(s) not auto-applied (diverged/new/absent/deleted need manual review)`);
  }
  if (!apply) {
    console.log("dry run: pass --apply to write the identical set to agent-os and push");
    return;
  }
  if (strict && skipped.length) throw new Error(`--strict: ${skipped.length} file(s) need manual review`);
  if (!selected.length) {
    console.log("nothing to apply");
    return;
  }

  const worktree = `${mkdtempSync(join(tmpdir(), "agentos-converge-"))}/wt`;
  git(["worktree", "add", "--detach", worktree, targetSha], repo);
  let pushed = false;
  try {
    const patchFile = join(tmpdir(), `agentos-converge-${Date.now()}.patch`);
    // Preserve git's exact diff bytes: trimming can eat a trailing blank
    // context line, which makes the patch fail with "corrupt patch".
    const patch = execFileSync("git", ["diff", "--binary", base, commit, "--", ...selected.map((entry) => entry.path)], {
      cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    });
    writeFileSync(patchFile, patch.endsWith("\n") ? patch : `${patch}\n`);
    execFileSync("git", ["apply", "--index", patchFile], { cwd: worktree, stdio: "inherit" });
    for (const entry of selected) {
      const staged = git(["rev-parse", `:${entry.path}`], worktree);
      const expected = blob(commit, entry.path, repo);
      if (!expected || staged !== expected) throw new Error(`post-image mismatch for ${entry.path}`);
    }
    const subject = message ?? `feat(work-os): converge ${commit.slice(0, 7)} into agent-os`;
    const body = [
      `Ports ${commit} (${git(["log", "-1", "--format=%s", commit], repo)}) from WrazyAI/work-os.`,
      ...(skipped.length
        ? ["", "Not converged (manual follow-up required):", ...skipped.map((entry) => `- ${entry.path} (${entry.status})`)]
        : []),
    ].join("\n");
    git(["commit", "-m", subject, "-m", body], worktree);
    execFileSync("git", ["push", remote, "HEAD:main"], { cwd: worktree, stdio: "inherit" });
    pushed = true;
    console.log(`✓ pushed ${git(["rev-parse", "--short", "HEAD"], worktree)} to ${remote}/main`);
  } finally {
    if (pushed) git(["worktree", "remove", "--force", worktree], repo);
    else console.error(`convergence worktree preserved at ${worktree}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
