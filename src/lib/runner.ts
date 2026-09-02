import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { config } from "./config";
import { repairCodexModelsCache } from "./codexCache";

// "fcc" is the Free Claude Code agent — it runs the same `claude` CLI but with
// the local fcc-server proxy env vars injected, routing requests to OpenRouter
// / NVIDIA NIM / Kimi / etc instead of api.anthropic.com.
// "codex" is OpenAI's Codex CLI (≥ 0.125 — supports `codex exec --json` for streaming).
// "opencode" is the opencode CLI (supports `opencode run --format json` for streaming).
export type AgentName = "claude" | "openclaw" | "hermes" | "gemini" | "antigravity" | "fcc" | "codex" | "opencode";

function binFor(agent: AgentName): string {
  // fcc is a virtual agent — it spawns the regular claude binary, just with
  // different env vars (see fccSpawnEnv in lib/fcc.ts).
  const key = agent === "fcc" ? "claude" : agent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bin = (config as any)[key];
  if (!bin) throw new Error(`${agent} is not installed or not configured. Set AGENTIC_OS_${key.toUpperCase()}_BIN or install the CLI.`);
  return bin;
}

// Build an env that agents can actually run subprocesses inside. The Next.js dev server's
// own process.env can be missing SHELL or have a stripped PATH, which causes Antigravity to
// crash mid-task with `fork/exec /bin/zsh: no such file or directory` and similar.
// We force SHELL + a baseline PATH covering all the standard macOS bin dirs + Homebrew + the
// user's local Node, so any tool the agent shells out to can be resolved.
function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = process.env;
  const ensurePath = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    `${process.env.HOME ?? "/Users/juliangoldie"}/.local/bin`,
    `${process.env.HOME ?? "/Users/juliangoldie"}/local/node/bin`,
  ];
  const existing = (base.PATH ?? "").split(":").filter(Boolean);
  const merged = [...new Set([...existing, ...ensurePath])].join(":");
  const env: NodeJS.ProcessEnv = {
    ...base,
    PATH: merged,
    SHELL: base.SHELL || "/bin/zsh",
    HOME: base.HOME || `/Users/${process.env.USER || "juliangoldie"}`,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    ...extra,
  };
  // macOS launchd sets ANTHROPIC_API_KEY / _AUTH_TOKEN / _BASE_URL to EMPTY strings
  // at the login-session level (the Claude desktop app does this), and every launchd
  // agent — including this dashboard — inherits them. An empty ANTHROPIC_API_KEY makes
  // the spawned `claude` CLI attempt API-key auth with a blank key → 401, instead of
  // falling back to the user's keychain OAuth login. Strip any ANTHROPIC_* var that is
  // empty so claude uses the real login. (The fcc agent passes REAL values via `extra`,
  // which are non-empty and therefore preserved.)
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
    if (!env[k]) delete env[k];
  }
  return env;
}

const FLAG_PATTERN = /^[A-Za-z0-9_\-./:=,@+%]+$/;
const MAX_ARG_LEN = 32_000;

// Max wall-clock runtime for streaming-spawn agent jobs. Override with
// RUNNER_STREAM_MAX_RUNTIME_MS (set to 0 to disable the watchdog).
const DEFAULT_STREAM_MAX_RUNTIME_MS = Number(process.env.RUNNER_STREAM_MAX_RUNTIME_MS ?? 30 * 60 * 1000);
const STREAM_KILL_GRACE_MS = 2_000;

function signalChildTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  if (!child.pid) {
    try { child.kill(signal); } catch {}
    return;
  }
  try { process.kill(-child.pid, signal); } catch {
    try { child.kill(signal); } catch {}
  }
}

export function validateFlagArgs(args: readonly string[]): string[] {
  return args.filter((a) => typeof a === "string" && a.length < MAX_ARG_LEN && FLAG_PATTERN.test(a));
}

function safeArg(a: unknown): string | null {
  if (typeof a !== "string") return null;
  if (a.length === 0 || a.length > MAX_ARG_LEN) return null;
  if (a.includes("\0")) return null;
  return a;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function run(
  agent: AgentName,
  args: readonly string[],
  opts: { timeoutMs?: number; cwd?: string; input?: string } = {}
): Promise<RunResult> {
  const cleanArgs = args.map(safeArg).filter((a): a is string => a !== null);
  const started = Date.now();

  let bin: string;
  try { bin = binFor(agent); }
  catch (e) {
    return { ok: false, code: -1, stdout: "", stderr: String(e), durationMs: 0 };
  }

  if (agent === "codex") repairCodexModelsCache();

  return new Promise<RunResult>((resolve) => {
    const child = spawn(bin, cleanArgs, {
      cwd: opts.cwd ?? process.env.HOME,
      env: agentEnv(),
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, opts.timeoutMs ?? 15_000);

    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - started });
    });
    child.on("error", (e) => {
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout, stderr: String(e), durationMs: Date.now() - started });
    });

    if (opts.input) child.stdin.write(opts.input);
    try { child.stdin.end(); } catch {}
  });
}

export function spawnStream(
  agent: AgentName,
  args: readonly string[],
  opts: { cwd?: string; input?: string; extraEnv?: Record<string, string>; maxRuntimeMs?: number } = {}
): ChildProcessWithoutNullStreams {
  const bin = binFor(agent);
  if (agent === "codex") repairCodexModelsCache(opts.extraEnv?.CODEX_HOME);
  const cleanArgs = args.map(safeArg).filter((a): a is string => a !== null);
  const child = spawn(bin, cleanArgs, {
    cwd: opts.cwd ?? process.env.HOME,
    env: agentEnv(opts.extraEnv ?? {}),
    stdio: ["pipe", "pipe", "pipe"],
    // Put the CLI and any descendants (for example Codex's helper process)
    // in their own process group so a stop request can terminate the whole run.
    detached: process.platform !== "win32",
  }) as ChildProcessWithoutNullStreams;

  // Watchdog: a hung agent CLI would otherwise hold a runner concurrency slot
  // forever (only an explicit user stop freed it). Terminates the whole process
  // group once the max runtime elapses; cleared on natural exit.
  const maxRuntimeMs = opts.maxRuntimeMs ?? DEFAULT_STREAM_MAX_RUNTIME_MS;
  if (Number.isFinite(maxRuntimeMs) && maxRuntimeMs > 0) {
    const watchdog = setTimeout(() => {
      signalChildTree(child, "SIGTERM");
      const force = setTimeout(() => signalChildTree(child, "SIGKILL"), STREAM_KILL_GRACE_MS);
      force.unref();
    }, maxRuntimeMs);
    watchdog.unref();
    child.once("close", () => clearTimeout(watchdog));
  }

  if (typeof opts.input === "string" && opts.input.length > 0) {
    // Write the prompt to stdin (no OS arg-length limit, no per-arg cap).
    child.stdin.write(opts.input);
  }
  try { child.stdin.end(); } catch {}
  return child;
}
