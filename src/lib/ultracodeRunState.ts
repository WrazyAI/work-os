// Browser-safe Ultracode run state and event reducer. Persistence belongs in
// ultracodeRuns.ts so client components never pull Node filesystem modules into
// their bundle.

export type SubagentStatus = "running" | "completed" | "failed";

export interface SubagentNode {
  taskId: string;
  toolUseId: string;
  description: string;
  subagentType: string;
  taskType?: string;
  prompt?: string;
  status: SubagentStatus;
  lastTool?: string;
  tokens: number;
  durationMs: number;
  summary?: string;
  outputFile?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface VerdictEntry {
  at: number;
  category: string;
  detail: string;
}

export interface RunTurn { prompt: string; at: number; }

export type RunActivity =
  | { kind: "thinking"; text: string }
  | {
      kind: "tool";
      id?: string;
      name: string;
      label?: string;
      input?: string;
      output?: string;
      status: "running" | "completed" | "failed";
    };

export interface UltracodeRun {
  id: string;
  prompt: string;
  project?: string;
  model: string;
  ultracode: boolean;
  sessionId?: string;
  turns: RunTurn[];
  activity: RunActivity[];
  startedAt: number;
  finishedAt?: number;
  status: "running" | "completed" | "failed" | "stopped";
  subagents: SubagentNode[];
  verdicts: VerdictEntry[];
  headline?: string;
  liveText?: string;
  resultText?: string;
  costUsd?: number;
  numTurns?: number;
  durationMs?: number;
  tokensTotal?: number;
}

export function newRun(partial: Pick<UltracodeRun, "id" | "prompt" | "model" | "ultracode"> & { project?: string }): UltracodeRun {
  return {
    ...partial,
    startedAt: Date.now(),
    status: "running",
    subagents: [],
    verdicts: [],
    turns: [{ prompt: partial.prompt, at: 0 }],
    activity: [],
  };
}

function eventPayload(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const rendered = typeof value === "string"
    ? value
    : (() => { try { return JSON.stringify(value, null, 2); } catch { return String(value); } })();
  // Tool output is useful context, not a second terminal. Strip terminal
  // control sequences and cap each payload so one command cannot flood the
  // browser, Postgres row, or the persisted activity accordion.
  const clean = rendered
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "")
    .replace(/\r/g, "");
  const limit = 12_000;
  return clean.length > limit ? `${clean.slice(0, limit)}\n… output truncated …` : clean;
}

function stringValue(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * Normalize Hermes' SSE vocabulary at the edge of the runner.
 *
 * Hermes has two compatible API surfaces in the wild: the notebook session
 * stream (`assistant.delta`, `tool.started`, …) and the OpenAI-compatible
 * stream (`hermes.tool.progress`, `choices[].delta.content`).  Keeping this
 * translation here means the browser, persistence layer, and replay tests all
 * consume one deterministic event contract.
 */
export function normalizeHermesEvent(eventName: string | undefined, payload: unknown): Record<string, unknown> | null {
  const raw = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const normalizedName = String(eventName ?? "").trim().replace(/^hermes\./, "");
  const choices = Array.isArray(raw.choices) ? raw.choices[0] as Record<string, unknown> | undefined : undefined;
  const choiceDelta = choices?.delta && typeof choices.delta === "object"
    ? choices.delta as Record<string, unknown>
    : undefined;
  const role = stringValue(raw.role, choiceDelta?.role);
  const toolName = stringValue(raw.tool_name, raw.tool, raw.name) ?? "tool";
  const toolId = stringValue(raw.toolCallId, raw.tool_call_id, raw.tool_id, raw.call_id, raw.id);
  const text = stringValue(raw.delta, raw.text, raw.content, raw.preview, raw.summary);
  const output = raw.result_text ?? raw.result ?? raw.output ?? raw.preview ?? raw.summary ?? raw.error;

  if (normalizedName === "assistant.delta") {
    const content = stringValue(raw.delta, choiceDelta?.content);
    return content ? { type: "message", role: "assistant", content, delta: true } : null;
  }
  if (normalizedName === "assistant.completed" || normalizedName === "response.output_text.done") {
    const content = stringValue(raw.content, raw.text, raw.result);
    return content ? { type: "result", result: content } : null;
  }
  if (normalizedName === "message.delta" || normalizedName === "message" || normalizedName === "content.delta") {
    // Some Hermes/OpenAI-compatible streams use the generic message event for
    // tool output as well as assistant text. Only assistant-role content is
    // allowed into the chat bubble; tool output stays in the activity rail.
    if (role && role !== "assistant") return null;
    const content = stringValue(raw.content, raw.text, raw.delta);
    return content ? { type: "message", role: "assistant", content, delta: raw.delta !== false } : null;
  }
  if (normalizedName === "reasoning.available" || normalizedName === "response.reasoning_summary_text.delta") {
    return text ? { type: "thinking", content: text, delta: true } : null;
  }
  if (normalizedName === "tool.progress") {
    if (toolName === "_thinking" || raw.kind === "thinking" || raw.type === "thinking") {
      return text ? { type: "thinking", content: text, delta: true } : null;
    }
    const status = stringValue(raw.status);
    if (status === "running") {
      return {
        type: "tool_call",
        id: toolId,
        name: toolName,
        label: stringValue(raw.label, raw.preview),
        args: raw.args ?? raw.input,
      };
    }
    if (status === "completed" || status === "failed") {
      return {
        type: "tool_result",
        id: toolId,
        name: toolName,
        output,
        error: status === "failed" || Boolean(raw.error),
      };
    }
    return null;
  }
  if (normalizedName === "tool.started" || normalizedName === "tool.start") {
    return {
      type: "tool_call",
      id: toolId,
      name: toolName,
      label: stringValue(raw.label, raw.preview, raw.summary),
      args: raw.args ?? raw.input,
    };
  }
  if (normalizedName === "tool.completed" || normalizedName === "tool.complete" || normalizedName === "tool.failed") {
    return {
      type: "tool_result",
      id: toolId,
      name: toolName,
      output,
      error: normalizedName === "tool.failed" || Boolean(raw.error) || raw.status === "failed",
    };
  }
  if (normalizedName === "run.completed" || normalizedName === "response.completed") {
    const messages = Array.isArray(raw.messages) ? raw.messages : [];
    const assistant = [...messages].reverse().find((message) =>
      message && typeof message === "object" && (message as Record<string, unknown>).role === "assistant",
    ) as Record<string, unknown> | undefined;
    const content = stringValue(raw.content, assistant?.content);
    return content ? { type: "result", result: content } : null;
  }
  if (normalizedName === "run.failed" || normalizedName === "error") {
    return { type: "error", message: stringValue(raw.message, raw.error) ?? "Hermes API error" };
  }
  if (normalizedName === "done") return { type: "done" };

  // Compatibility streams sometimes omit `event:` and send OpenAI-style
  // `choices[].delta.content`. Only accept known assistant-text events here;
  // never turn tool/progress/command payloads into assistant prose. The old
  // broad fallback was the source of messy command output in the transcript.
  const assistantTextEvent = !normalizedName
    || normalizedName === "response.output_text.delta"
    || normalizedName === "chat.delta"
    || normalizedName === "assistant.message.delta"
    || (normalizedName.endsWith(".delta") && !/(tool|thinking|reasoning|command|execution|progress|status)/i.test(normalizedName));
  if (!assistantTextEvent) return null;
  if (role && role !== "assistant") return null;
  const fallbackContent = stringValue(choiceDelta?.content, raw.delta, raw.content, raw.text);
  return fallbackContent ? { type: "message", role: "assistant", content: fallbackContent, delta: true } : null;
}

export function applyEvent(run: UltracodeRun, raw: unknown): UltracodeRun {
  if (!raw || typeof raw !== "object") return run;
  run.activity ??= [];
  const e = raw as Record<string, unknown>;
  const type = e["type"];
  const subtype = e["subtype"];
  const rel = () => Date.now() - run.startedAt;

  if (!run.sessionId && typeof e["session_id"] === "string") run.sessionId = e["session_id"] as string;

  // Employee chat providers normalize their streams to these compact events.
  // Keep the answer and its ordered work log in the same replayable run state.
  if (type === "message" && e["role"] === "assistant" && typeof e["content"] === "string") {
    const content = e["content"] as string;
    run.liveText = e["delta"] === false ? content : `${run.liveText ?? ""}${content}`;
    if (run.liveText.length > 100_000) run.liveText = run.liveText.slice(-100_000);
  }

  if (type === "thinking" && typeof e["content"] === "string") {
    const content = eventPayload(e["content"]) ?? "";
    if (!content) return run;
    const last = run.activity.at(-1);
    if (e["delta"] === true && last?.kind === "thinking") {
      last.text = `${last.text}${content}`.slice(-48_000);
    } else run.activity.push({ kind: "thinking", text: content.slice(-48_000) });
  }

  if (type === "tool_call") {
    const id = stringValue(e["id"], e["tool_id"], e["toolCallId"]);
    const name = String(e["name"] ?? "tool");
    const existing = id
      ? [...run.activity].reverse().find((entry): entry is Extract<RunActivity, { kind: "tool" }> => entry.kind === "tool" && entry.id === id)
      : undefined;
    if (existing) {
      existing.input = eventPayload(e["args"] ?? e["input"]) ?? existing.input;
      existing.label = stringValue(e["label"]) ?? existing.label;
      existing.status = "running";
      return run;
    }
    const toolEntry: Extract<RunActivity, { kind: "tool" }> = {
      kind: "tool",
      name,
      status: "running",
    };
    if (id) toolEntry.id = id;
    const label = stringValue(e["label"]);
    if (label) toolEntry.label = label;
    const input = eventPayload(e["args"] ?? e["input"]);
    if (input) toolEntry.input = input;
    run.activity.push(toolEntry);
  }

  if (type === "tool_result") {
    const name = String(e["name"] ?? "tool");
    const id = stringValue(e["id"], e["tool_id"], e["toolCallId"]);
    const existing = [...run.activity].reverse()
      .find((entry): entry is Extract<RunActivity, { kind: "tool" }> =>
        entry.kind === "tool" && entry.status === "running" &&
        (id ? entry.id === id : entry.name === name || name === "tool"));
    const output = eventPayload(e["output"] ?? e["result"] ?? e["error"]);
    if (existing) {
      if (output) existing.output = output;
      existing.status = e["error"] ? "failed" : "completed";
    } else {
      run.activity.push({ kind: "tool", name, output, status: e["error"] ? "failed" : "completed" });
    }
  }

  if (type === "stream_event" && !e["parent_tool_use_id"]) {
    const ev = e["event"] as Record<string, unknown> | undefined;
    if (ev && ev["type"] === "content_block_delta") {
      const delta = ev["delta"] as Record<string, unknown> | undefined;
      const text = delta && typeof delta["text"] === "string" ? delta["text"] : "";
      if (text) {
        const next = (run.liveText ?? "") + text;
        run.liveText = next.length > 12000 ? next.slice(-12000) : next;
      }
    }
  }

  if (type === "system" && subtype === "task_started") {
    const taskId = String(e["task_id"] ?? "");
    if (!taskId) return run;
    if (!run.subagents.some((node) => node.taskId === taskId)) {
      run.subagents.push({
        taskId,
        toolUseId: String(e["tool_use_id"] ?? ""),
        description: String(e["description"] ?? "subagent"),
        subagentType: String(e["subagent_type"] ?? "general-purpose"),
        taskType: e["task_type"] ? String(e["task_type"]) : undefined,
        prompt: e["prompt"] ? String(e["prompt"]) : undefined,
        status: "running",
        tokens: 0,
        durationMs: 0,
        startedAt: rel(),
      });
    }
    return run;
  }

  if (type === "system" && subtype === "task_progress") {
    const node = run.subagents.find((entry) => entry.taskId === String(e["task_id"] ?? ""));
    if (node) {
      if (e["description"]) node.description = String(e["description"]);
      if (e["last_tool_name"]) node.lastTool = String(e["last_tool_name"]);
      const usage = e["usage"] as Record<string, unknown> | undefined;
      if (usage) {
        if (typeof usage["total_tokens"] === "number") node.tokens = usage["total_tokens"];
        if (typeof usage["duration_ms"] === "number") node.durationMs = usage["duration_ms"];
      }
    }
    return run;
  }

  if (type === "system" && subtype === "task_notification") {
    const node = run.subagents.find((entry) => entry.taskId === String(e["task_id"] ?? ""));
    if (node) {
      const status = String(e["status"] ?? "");
      node.status = status === "completed" ? "completed" : status === "failed" ? "failed" : node.status;
      if (e["summary"]) node.summary = String(e["summary"]);
      if (e["output_file"]) node.outputFile = String(e["output_file"]);
      const usage = e["usage"] as Record<string, unknown> | undefined;
      if (usage) {
        if (typeof usage["total_tokens"] === "number") node.tokens = usage["total_tokens"];
        if (typeof usage["duration_ms"] === "number") node.durationMs = usage["duration_ms"];
      }
      node.finishedAt = rel();
    }
    return run;
  }

  if (type === "system" && subtype === "post_turn_summary") {
    const detail = e["status_detail"] ? String(e["status_detail"]) : "";
    const category = e["status_category"] ? String(e["status_category"]) : "";
    if (detail) {
      run.headline = detail;
      run.verdicts.push({ at: rel(), category, detail });
    }
    return run;
  }

  if (type === "result") {
    run.status = e["is_error"] ? "failed" : "completed";
    if (typeof e["total_cost_usd"] === "number") run.costUsd = e["total_cost_usd"];
    if (typeof e["num_turns"] === "number") run.numTurns = e["num_turns"];
    if (typeof e["duration_ms"] === "number") run.durationMs = e["duration_ms"];
    if (typeof e["result"] === "string") {
      run.resultText = e["result"];
      if (!run.liveText) run.liveText = e["result"];
    }
    const usage = e["usage"] as Record<string, unknown> | undefined;
    if (usage) {
      run.tokensTotal = ((usage["input_tokens"] as number) ?? 0) + ((usage["output_tokens"] as number) ?? 0)
        + ((usage["cache_read_input_tokens"] as number) ?? 0) + ((usage["cache_creation_input_tokens"] as number) ?? 0);
    }
    run.finishedAt = Date.now();
  }

  if (type === "error" && typeof e["message"] === "string") {
    run.status = "failed";
    run.resultText = String(e["message"]);
    run.finishedAt = Date.now();
  }

  return run;
}
