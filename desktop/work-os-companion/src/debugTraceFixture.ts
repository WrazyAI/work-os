import type { DiagnosticEvent } from "./diagnostics";

/** Dev-only trace fixture so the debugger's trace UI can be exercised in a browser
 *  (`debug.html?preview-trace`). Never reachable in a packaged build. */
const SCRIPT: Array<Omit<DiagnosticEvent, "id" | "timestamp" | "sessionId">> = [
  { level: "info", source: "frontend", category: "app.webview.start", message: "WebView booting" },
  { level: "debug", source: "sync", category: "sync.queue.enqueue", message: "Queued 1 local action", correlationId: "c-8841" },
  { level: "info", source: "ipc", category: "workday.fetch", message: "Workday state loaded", durationMs: 214 },
  { level: "warn", source: "sync", category: "sync.push.retry", message: "Push failed, retry scheduled in 30s", correlationId: "c-8842" },
  { level: "error", source: "rust", category: "stronghold.read", message: "Vault entry missing, prompting again" },
  { level: "info", source: "storage", category: "cache.persist", message: "Query cache written" },
  { level: "debug", source: "frontend", category: "planner.interpret", message: "Interpreted 3 commitments", durationMs: 981 },
  { level: "info", source: "ipc", category: "uploads.poll", message: "Upload job ready" },
];

function sample(index: number): DiagnosticEvent {
  const event = SCRIPT[index % SCRIPT.length];
  return {
    ...event,
    id: `preview-${index}`,
    sessionId: "preview-session",
    timestamp: new Date(Date.now() - (SCRIPT.length - (index % SCRIPT.length)) * 1000).toISOString(),
  };
}

export function traceFixtureEvents(): DiagnosticEvent[] {
  return SCRIPT.map((_, index) => sample(index));
}

export function startTraceFixtureStream(onEvent: (event: DiagnosticEvent) => void): () => void {
  let index = SCRIPT.length;
  const timer = window.setInterval(() => onEvent(sample(index++)), 700);
  return () => window.clearInterval(timer);
}
