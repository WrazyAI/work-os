import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";

export interface ImportIo {
  exists: (path: string) => boolean;
  read: (path: string) => string;
}

const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js"];

export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  io: Pick<ImportIo, "exists">,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  } else return null;
  for (const extension of EXTENSIONS) {
    if (io.exists(base + extension)) return base + extension;
  }
  for (const extension of EXTENSIONS.slice(1)) {
    const candidate = `${base}/index${extension}`;
    if (io.exists(candidate)) return candidate;
  }
  return null;
}

export function collectRunnerImports(entry: string, io: ImportIo): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !io.exists(file)) continue;
    seen.add(file);
    const source = io.read(file);
    const specifiers = [
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?from\s*["']([^"']+)["']/g),
      ...source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g),
      ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...source.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(file, specifier, io);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

export function runnerRelevantChanges(changed: string[], closure: Set<string>): string[] {
  return changed.filter((file) => closure.has(file));
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function readFlag(argv: string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const restartRequested = argv.includes("--restart-runner");
  const repo = readFlag(argv, "--repo", process.cwd());
  const entry = readFlag(argv, "--entry", "scripts/agent-runner.ts");
  const previousFile = readFlag(argv, "--previous-file", ".deployed-commit");
  const runnerMarkerFile = readFlag(argv, "--runner-marker", ".runner-deployed-commit");
  const markOnly = argv.includes("--mark");
  const report: Record<string, unknown> = { entry, relevant: [], restarted: false };

  if (!existsSync(join(repo, entry))) {
    report.skipped = "no runner entry in this repository";
    if (json) console.log(JSON.stringify(report));
    else console.log("runner check: no runner entry in this repository; skipping");
    return;
  }

  const markerPath = join(repo, runnerMarkerFile);
  const previousFromMarker = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : "";
  const previous = previousFromMarker
    ? previousFromMarker
    : existsSync(join(repo, previousFile))
      ? readFileSync(join(repo, previousFile), "utf8").trim()
      : "";
  const current = readFlag(argv, "--current", git(repo, ["rev-parse", "HEAD"]));

  if (markOnly) {
    writeFileSync(markerPath, `${current}\n`);
    console.log(`runner baseline marked at ${current.slice(0, 7)}`);
    return;
  }

  if (!previous) {
    report.skipped = "no deploy marker; the check activates after the next redeploy";
    if (json) console.log(JSON.stringify(report));
    else console.log("runner check: no deploy marker yet; skipping");
    return;
  }

  let changed: string[];
  try {
    changed = git(repo, ["diff", "--name-only", previous, current]).split("\n").filter(Boolean);
  } catch {
    report.skipped = `previous marker ${previous} is not a commit in this repository`;
    if (json) console.log(JSON.stringify(report));
    return;
  }

  const io: ImportIo = {
    exists: (path) => existsSync(join(repo, path)),
    read: (path) => readFileSync(join(repo, path), "utf8"),
  };
  const relevant = runnerRelevantChanges(changed, collectRunnerImports(entry, io));
  report.previous = previous;
  report.current = current;
  report.relevant = relevant;

  if (!relevant.length) {
    if (json) console.log(JSON.stringify(report));
    else console.log("runner check: changed files do not touch the runner's imports");
    return;
  }

  if (!restartRequested) {
    writeFileSync(markerPath, `${previous}\n`);
    console.log(`⚠ changed files touch the runner's imports:\n${relevant.map((file) => `  - ${file}`).join("\n")}`);
    console.log("  restart it when no job is in flight: systemctl --user restart agentos-runner");
    console.log("  then clear this reminder: node --import tsx scripts/runner-restart-check.mts --mark");
    console.log("  (or re-run: npm run redeploy -- --restart-runner)");
    if (json) console.log(JSON.stringify(report));
    return;
  }

  const mainPid = execFileSync("systemctl", ["--user", "show", "agentos-runner", "-p", "MainPID", "--value"], {
    encoding: "utf8",
  }).trim();
  let children = "";
  if (mainPid && mainPid !== "0") {
    try {
      children = execFileSync("pgrep", ["-P", mainPid], { encoding: "utf8" }).trim();
    } catch {
      children = "";
    }
  }
  if (children) {
    report.reason = "runner has in-flight child processes; restart skipped";
    console.log("⚠ runner restart skipped: an agent job is in flight");
    if (json) console.log(JSON.stringify(report));
    return;
  }
  execFileSync("systemctl", ["--user", "restart", "agentos-runner"], { stdio: "ignore" });
  writeFileSync(markerPath, `${current}\n`);
  report.restarted = true;
  report.marker = current;
  console.log("✓ restarted agentos-runner with the new code");
  if (json) console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
