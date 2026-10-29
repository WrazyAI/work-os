#!/usr/bin/env node
/**
 * work-os-ledger.mjs
 *
 * The work ledger: create, read, update, and complete the tasks that track what
 * an agent is doing in this workspace. It talks to the Work OS Agent API with a
 * person-scoped token, so the ledger lives in the same record as the work.
 *
 * Usage:
 *   node scripts/work-os-ledger.mjs create --file tasks.json
 *   node scripts/work-os-ledger.mjs create --json '{"tasks":[{"name":"..."}]}'
 *   node scripts/work-os-ledger.mjs list --query "deploy"
 *   node scripts/work-os-ledger.mjs get <taskId>
 *   node scripts/work-os-ledger.mjs describe <taskId> --description "..."
 *   node scripts/work-os-ledger.mjs complete <taskId> [<taskId>...]
 *
 * JSON format (tasks.json):
 *   {
 *     "project_id": "uuid",              // optional; defaults to the workspace default
 *     "project": "EOD Report",           // optional; resolved by name instead of id
 *     "labels": ["extra-label"],         // optional; agent-ledger is always added
 *     "tasks": [
 *       {
 *         "name": "Parent task title",   // required
 *         "description": "Optional description",
 *         "subtasks": ["Subtask 1", "Subtask 2"],
 *         "due_date": "2026-11-02",      // optional
 *         "priority": "high",            // optional
 *         "story_points": 3,             // optional
 *         "idempotency_key": "..."       // optional; makes a retry a no-op
 *       }
 *     ]
 *   }
 *
 * Auth: WORK_OS_API_TOKEN (or the legacy WORK_OS_AGENT_TOKEN), or --token-file
 * <path>. The token is read from the process environment, WORK_OS_LEDGER_ENV_FILE,
 * the current repo's .env.local/.env (including the main checkout when run from a
 * worktree), or the VPS Agent OS .env.local/.env. Never print the token.
 *
 * Base URL: WORK_OS_API_BASE, default https://app.wrazyos.com/api/agent/v1
 */

import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

export const DEFAULT_API_BASE = "https://app.wrazyos.com/api/agent/v1";
export const LEDGER_LABEL = "agent-ledger";
export const ENV_TOKEN_KEYS = ["WORK_OS_API_TOKEN", "WORK_OS_AGENT_TOKEN"];
const VPS_ENV_FILES = ["/home/dev/agent-os/.env.local", "/home/dev/agent-os/.env"];

/** Parse argv into the flags this tool understands. */
export function parseArgs(argv) {
  const flags = { _: [] };
  const takesValue = new Set(["--file", "--json", "--project", "--project-name", "--parent", "--label", "--query", "--limit", "--description", "--token-file", "--api-base"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--include-completed" || arg === "--json-output" || arg === "--help") {
      flags[arg.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    } else if (takesValue.has(arg) && argv[i + 1] !== undefined) {
      flags[arg.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      flags._.push(arg);
    }
  }
  if (flags.file && flags.json) throw new Error("Provide --file or --json, not both");
  return flags;
}

/** The Agent API body for one ledger task. Kept pure so the shape is testable. */
export function taskPayload(task, options = {}) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("Each task must be an object");
  const name = typeof task.name === "string" ? task.name.trim() : "";
  if (!name) throw new Error("Each task needs a name");
  const labels = [...new Set([LEDGER_LABEL, ...(options.labels ?? []), ...(Array.isArray(task.labels) ? task.labels : [])])];
  const payload = {
    name,
    labels,
    ...(typeof task.description === "string" && task.description.trim() ? { description: task.description.trim() } : {}),
    ...(task.due_date ? { due_date: task.due_date } : {}),
    ...(task.priority ? { priority: task.priority } : {}),
    ...(typeof task.story_points === "number" ? { story_points: task.story_points } : {}),
    ...(options.projectId ? { project_id: options.projectId } : {}),
    ...(options.parentId ? { parent_task_id: options.parentId } : {}),
  };
  return payload;
}

/** Read the ledger document, accepting the shape the retired Nifty logger used. */
export function readLedgerDocument(raw) {
  const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!doc || typeof doc !== "object") throw new Error("The ledger document must be an object");
  if (!Array.isArray(doc.tasks) || !doc.tasks.length) throw new Error("The ledger document needs at least one task");
  return {
    projectId: typeof doc.project_id === "string" && doc.project_id.trim() ? doc.project_id.trim() : null,
    projectName: typeof doc.project === "string" && doc.project.trim() ? doc.project.trim() : null,
    labels: Array.isArray(doc.labels) ? doc.labels.filter((label) => typeof label === "string" && label.trim()) : [],
    parentId: typeof doc.existing_parent_task_id === "string" && doc.existing_parent_task_id.trim() ? doc.existing_parent_task_id.trim() : null,
    tasks: doc.tasks,
  };
}

/** The env files the ledger reads, in precedence order. Worktrees resolve the
 * main checkout through git's common dir so a token in the canonical repo env
 * is visible from every worktree. */
export function envFileCandidates(cwd = process.cwd(), env = process.env) {
  const paths = [];
  const add = (path) => { if (path && !paths.includes(path)) paths.push(path); };
  if (typeof env.WORK_OS_LEDGER_ENV_FILE === "string" && env.WORK_OS_LEDGER_ENV_FILE.trim()) {
    add(resolve(env.WORK_OS_LEDGER_ENV_FILE.trim()));
  }
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (commonDir) {
      const root = dirname(commonDir);
      add(resolve(root, ".env.local"));
      add(resolve(root, ".env"));
    }
  } catch {
    // Not a git checkout or git is unavailable; cwd and the VPS paths still apply.
  }
  add(resolve(cwd, ".env.local"));
  add(resolve(cwd, ".env"));
  for (const path of VPS_ENV_FILES) add(path);
  return paths;
}

/** Extract the token from an env file's contents, preferring the canonical key. */
export function parseEnvToken(raw, keys = ENV_TOKEN_KEYS) {
  const found = new Map();
  for (const line of String(raw).split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (!keys.includes(key) || found.has(key)) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) found.set(key, value);
  }
  for (const key of keys) {
    const value = found.get(key);
    if (value) return value;
  }
  return null;
}

function loadEnvToken() {
  for (const key of ENV_TOKEN_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const path of envFileCandidates()) {
    if (!existsSync(path)) continue;
    const token = parseEnvToken(readFileSync(path, "utf8"));
    if (token) return token;
  }
  return null;
}

function resolveToken(flags) {
  if (flags.tokenFile) {
    if (!existsSync(flags.tokenFile)) throw new Error(`Token file not found: ${basename(flags.tokenFile)}`);
    const value = readFileSync(flags.tokenFile, "utf8").trim();
    if (!value) throw new Error("Token file is empty");
    return value;
  }
  const token = loadEnvToken();
  if (!token) throw new Error("Set WORK_OS_API_TOKEN (or WORK_OS_AGENT_TOKEN), pass --token-file, or put it in the repo's gitignored .env/.env.local (or /home/dev/agent-os/.env.local on the VPS)");
  return token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(api, token, method, path, body, attempt = 0) {
  const response = await fetch(api + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json", "Idempotency-Key": randomUUID() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (response.status === 429 && attempt < 2) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    await sleep((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000 * (attempt + 1));
    return request(api, token, method, path, body, attempt + 1);
  }
  const text = await response.text().catch(() => "");
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) {
    const code = parsed?.code ?? parsed?.error ?? response.status;
    throw new Error(`${method} ${path} failed: ${code}${parsed?.error && parsed?.code ? ` — ${parsed.error}` : ""}`);
  }
  return parsed;
}

async function resolveProject(api, token, flags, doc) {
  if (flags.project) return flags.project;
  if (doc.projectId) return doc.projectId;
  const name = flags.projectName ?? doc.projectName;
  if (!name) return null;
  const options = await request(api, token, "GET", "/options");
  const projects = Array.isArray(options?.projects) ? options.projects : [];
  const match = projects.find((project) => String(project.name ?? "").toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new Error(`No project named "${name}". Available: ${projects.map((project) => project.name).join(", ") || "none"}`);
  }
  return match.id;
}

function taskIdOf(task) {
  return String(task?.id ?? task?.provider_task_id ?? "");
}

async function createCommand(api, token, flags) {
  const raw = flags.file ? readFileSync(flags.file, "utf8") : flags.json;
  if (!raw) throw new Error("create needs --file <path> or --json '<document>'");
  const doc = readLedgerDocument(raw);
  const projectId = await resolveProject(api, token, flags, doc);
  const parentId = flags.parent ?? doc.parentId;
  const labels = [...doc.labels, ...(flags.label ? [flags.label] : [])];
  const created = [];

  for (const task of doc.tasks) {
    const payload = taskPayload(task, { projectId, parentId, labels });
    if (flags.dryRun) {
      const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
      console.log(`  [dry-run] ${payload.name}${subtasks.length ? ` (+${subtasks.length} subtasks)` : ""}`);
      created.push({ id: "dry-run", name: payload.name, subtasks: [] });
      continue;
    }
    const result = await request(api, token, "POST", "/tasks", payload);
    const taskId = taskIdOf(result?.task ?? result);
    if (!taskId) throw new Error(`The API created "${payload.name}" but returned no id`);
    console.log(`  [OK] ${taskId}  ${payload.name}`);
    const subtaskIds = [];
    for (const subtask of Array.isArray(task.subtasks) ? task.subtasks : []) {
      const name = typeof subtask === "string" ? subtask.trim() : "";
      if (!name) throw new Error(`A subtask of "${payload.name}" needs a name`);
      const subResult = await request(api, token, "POST", "/tasks", taskPayload({ name }, { projectId, parentId: taskId, labels }));
      const subId = taskIdOf(subResult?.task ?? subResult);
      if (!subId) throw new Error(`The API created subtask "${name}" but returned no id`);
      console.log(`    [OK] ${subId}  ${name}`);
      subtaskIds.push({ id: subId, name });
    }
    created.push({ id: taskId, name: payload.name, subtasks: subtaskIds });
  }

  if (flags.jsonOutput) console.log(JSON.stringify({ projectId, created }, null, 2));
  else if (!flags.dryRun) console.log(`\nCreated ${created.length} parent task(s) and ${created.reduce((sum, item) => sum + item.subtasks.length, 0)} subtask(s).`);
  return created;
}

async function listCommand(api, token, flags) {
  const limit = Math.min(100, Math.max(1, Number(flags.limit ?? 25)));
  const query = String(flags.query ?? "").trim().toLowerCase();
  const collected = [];
  let cursor = null;
  for (let page = 0; page < 5 && collected.length < 200; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const result = await request(api, token, "GET", `/tasks?${params}`);
    const tasks = Array.isArray(result?.tasks) ? result.tasks : [];
    collected.push(...tasks);
    cursor = result?.cursor?.next ?? null;
    if (!cursor || !tasks.length) break;
  }
  const rows = collected
    .filter((task) => flags.includeCompleted || task.completed !== true)
    .filter((task) => !query || String(task.title ?? "").toLowerCase().includes(query))
    .slice(0, limit);
  if (flags.jsonOutput) {
    console.log(JSON.stringify(rows.map((task) => ({
      id: task.id, title: task.title, completed: task.completed, labels: task.labels, projectId: task.project_id,
    })), null, 2));
    return rows;
  }
  if (!rows.length) {
    console.log(query ? `No open ledger task matches "${query}".` : "No open ledger tasks.");
    return rows;
  }
  for (const task of rows) {
    const mark = task.completed === true ? "x" : " ";
    console.log(`  [${mark}] ${task.id}  ${task.title}`);
  }
  console.log(`\n${rows.length} task(s).`);
  return rows;
}

async function getCommand(api, token, flags) {
  const [taskId] = flags._;
  if (!taskId) throw new Error("get needs a task id");
  const result = await request(api, token, "GET", `/tasks/${encodeURIComponent(taskId)}`);
  const task = result?.task ?? result;
  if (flags.jsonOutput) { console.log(JSON.stringify(task, null, 2)); return task; }
  console.log(`  ${taskId}  ${task.title ?? task.name ?? ""}`);
  console.log(`  completed: ${task.completed}   status: ${task.status}`);
  if (task.description) console.log(`  ${String(task.description).slice(0, 400)}`);
  const subtasks = Array.isArray(result?.subtasks) ? result.subtasks : [];
  for (const subtask of subtasks) {
    console.log(`    [${subtask.completed === true ? "x" : " "}] ${subtask.id}  ${subtask.title}`);
  }
  return task;
}

async function describeCommand(api, token, flags) {
  const [taskId] = flags._;
  if (!taskId) throw new Error("describe needs a task id");
  if (typeof flags.description !== "string") throw new Error("describe needs --description");
  const result = await request(api, token, "PATCH", `/tasks/${encodeURIComponent(taskId)}`, { description: flags.description });
  const task = result?.task ?? result;
  if (flags.jsonOutput) { console.log(JSON.stringify(task, null, 2)); return task; }
  console.log(`  [OK] ${taskId} description updated`);
  return task;
}

async function completeCommand(api, token, flags) {
  if (!flags._.length) throw new Error("complete needs at least one task id");
  const results = [];
  for (const taskId of flags._) {
    // Completing a parent also closes its open subtasks, so one call is enough.
    await request(api, token, "POST", `/tasks/${encodeURIComponent(taskId)}/complete`, {});
    const readBack = await request(api, token, "GET", `/tasks/${encodeURIComponent(taskId)}`);
    const task = readBack?.task ?? readBack;
    console.log(`  [OK] ${taskId} completed=${task.completed === true}`);
    results.push({ id: taskId, completed: task.completed === true, title: task.title });
  }
  if (flags.jsonOutput) console.log(JSON.stringify(results, null, 2));
  return results;
}

function showHelp() {
  console.log(`
Usage: node scripts/work-os-ledger.mjs <command> [options]

Commands:
  create   --file <path> | --json '<doc>'   Create tasks and subtasks
  list     [--query <text>] [--limit N]     List open ledger tasks
  get      <taskId>                         Show one task with subtasks
  describe <taskId> --description <text>    Update a task description
  complete <taskId> [<taskId>...]           Complete tasks and read back

Options:
  --project <uuid>        Work OS project id
  --project-name <name>   Resolve the project by name (e.g. "EOD Report")
  --parent <taskId>       Attach new tasks as subtasks of an existing task
  --label <name>          Extra label besides ${LEDGER_LABEL}
  --dry-run               Validate and print without writing
  --include-completed     Include completed tasks in list
  --json-output           Machine-readable result
  --token-file <path>     Read the bearer token from a file
  --api-base <url>        Override the API base
  --help                  Show this help

Token lookup: WORK_OS_API_TOKEN or WORK_OS_AGENT_TOKEN in the process
environment, WORK_OS_LEDGER_ENV_FILE, the current repo's .env.local/.env
(worktrees resolve the main checkout), then /home/dev/agent-os/.env.local/.env.
Never print or commit the token.

The document may carry "project", "project_id", "labels", and
"existing_parent_task_id" beside "tasks". Each task needs a name and may carry
description, subtasks, due_date, priority, story_points.
`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || !flags._.length) { showHelp(); return; }
  const command = flags._.shift();
  const api = String(flags.apiBase ?? process.env.WORK_OS_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const token = resolveToken(flags);
  switch (command) {
    case "create": await createCommand(api, token, flags); break;
    case "list": await listCommand(api, token, flags); break;
    case "get": await getCommand(api, token, flags); break;
    case "describe": await describeCommand(api, token, flags); break;
    case "complete": await completeCommand(api, token, flags); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`FATAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
