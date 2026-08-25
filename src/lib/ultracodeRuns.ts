// Ultracode run telemetry — parse Claude Code's stream-json into a structured
// "swarm" model, and persist each run so it's replayable (the video money shot:
// "we built this with Ultracode — here's the replay of 80 agents doing it").
//
// Event shapes confirmed by capturing a real `claude -p --effort xhigh
// --include-hook-events` run (see task #56):
//
//   system/task_started     { task_id, tool_use_id, description, subagent_type,
//                             task_type, prompt }
//   system/task_progress    { task_id, description, last_tool_name,
//                             usage:{ total_tokens, tool_uses, duration_ms } }
//   system/task_notification { task_id, status, summary, output_file,
//                             usage:{ total_tokens, duration_ms } }
//   system/post_turn_summary { status_category, status_detail }  ← the headline
//   result/success          { total_cost_usd, num_turns, duration_ms, result,
//                             usage:{...} }                       ← exact cost
//
// The parser is pure + incremental: feed it raw event objects (live, as they
// stream) OR replay a saved array. Both the client (live Swarm Map) and the
// server (persistence) use the same reducer so they never drift.

import { readdir, readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { UltracodeRun } from "./ultracodeRunState";

export {
  newRun,
  applyEvent,
  normalizeHermesEvent,
  type SubagentNode,
  type SubagentStatus,
  type UltracodeRun,
  type VerdictEntry,
  type RunTurn,
  type RunActivity,
} from "./ultracodeRunState";

export const ULTRACODE_RUNS_ROOT = process.env.AGENTIC_OS_ULTRACODE_RUNS
  ?? path.join(os.homedir(), ".agentic-os", "ultracode-runs");

// ── Persistence ─────────────────────────────────────────────────────────────

export async function saveRun(run: UltracodeRun): Promise<void> {
  if (!existsSync(ULTRACODE_RUNS_ROOT)) await mkdir(ULTRACODE_RUNS_ROOT, { recursive: true });
  if (!/^[A-Za-z0-9_.-]+$/.test(run.id)) return;
  const file = path.join(ULTRACODE_RUNS_ROOT, `${run.id}.json`);
  const tmp = `${file}.tmp-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(run, null, 2), "utf8");
  await rename(tmp, file);
}

export interface RunSummary {
  id: string;
  prompt: string;
  headline?: string;
  status: UltracodeRun["status"];
  subagentCount: number;
  costUsd?: number;
  durationMs?: number;
  startedAt: number;
}

export async function listRuns(limit = 50): Promise<RunSummary[]> {
  if (!existsSync(ULTRACODE_RUNS_ROOT)) return [];
  const out: RunSummary[] = [];
  try {
    const files = await readdir(ULTRACODE_RUNS_ROOT);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const run = JSON.parse(await readFile(path.join(ULTRACODE_RUNS_ROOT, f), "utf8")) as UltracodeRun;
        out.push({
          id: run.id,
          prompt: run.prompt,
          headline: run.headline,
          status: run.status,
          subagentCount: run.subagents?.length ?? 0,
          costUsd: run.costUsd,
          durationMs: run.durationMs,
          startedAt: run.startedAt,
        });
      } catch { /* skip malformed */ }
    }
  } catch { /* ignore */ }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out.slice(0, limit);
}

export async function getRun(id: string): Promise<UltracodeRun | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return null;
  const file = path.join(ULTRACODE_RUNS_ROOT, `${id}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, "utf8")) as UltracodeRun; }
  catch { return null; }
}

export async function deleteRun(id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) return false;
  const file = path.join(ULTRACODE_RUNS_ROOT, `${id}.json`);
  if (!existsSync(file)) return false;
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(file);
    return true;
  } catch { return false; }
}

// Tiny helper so the route can stamp a run id.
export function makeRunId(): string {
  return `uc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runFileMtime(id: string): Promise<number | null> {
  const file = path.join(ULTRACODE_RUNS_ROOT, `${id}.json`);
  const s = await stat(file).catch(() => null);
  return s ? s.mtimeMs : null;
}
