import type { DiagnosticEvent } from "./diagnostics";
import type { DiagnosticsPage, DiagnosticsPageInput, PagedDiagnosticEvent } from "./debugDiagnostics";
import { TRACE_PAGE, TRACE_LOADED_CAP } from "./traceView";

/** Dev-only trace fixture so the debugger's trace can be exercised in a browser
 *  (`debug.html?preview-trace`). It mirrors the Rust ring: 2,000 events are generated
 *  and only the newest 1,000 remain, and pages follow the same contract as
 *  `diagnostics_page`. Never reachable in a packaged build. */
export const TRACE_FIXTURE_GENERATED = 2000;
export const TRACE_FIXTURE_CAPACITY = 1000;

type Template = Omit<DiagnosticEvent, "id" | "timestamp" | "sessionId">;

const TEMPLATES: Template[] = [
  { level: "info", source: "frontend", category: "app.webview.start", message: "WebView booting" },
  { level: "debug", source: "sync", category: "sync.queue.enqueue", message: "Queued 1 local action", correlationId: "c-8841" },
  { level: "trace", source: "sync", category: "api.request.started", message: "api.request", metadata: { path: "/api/work-os/attendance/observe", method: "POST" } },
  { level: "info", source: "sync", category: "api.request.completed", message: "api.request", durationMs: 214, metadata: { path: "/api/work-os/attendance/observe", method: "POST" } },
  { level: "info", source: "sync", category: "api.request.completed", message: "api.request", durationMs: 1320, metadata: { path: "/api/work-os/me/workday", method: "GET" } },
  { level: "error", source: "sync", category: "api.request.failed", message: "Work OS request failed (503)", durationMs: 1870, metadata: { path: "/api/work-os/me/plan", method: "PUT" } },
  { level: "warn", source: "sync", category: "sync.push.retry", message: "Push failed, retry scheduled in 30s", correlationId: "c-8842" },
  { level: "error", source: "rust", category: "stronghold.read", message: "Vault entry missing, prompting again" },
  { level: "info", source: "storage", category: "cache.persist", message: "Query cache written" },
  { level: "debug", source: "frontend", category: "planner.interpret", message: "Interpreted 3 commitments", durationMs: 981 },
  { level: "info", source: "ipc", category: "uploads.poll", message: "Upload job ready" },
];

const BASE_MS = Date.parse("2026-10-09T13:00:00Z");

function fixtureEvent(seq: number): PagedDiagnosticEvent {
  const template = TEMPLATES[(seq * 5 + Math.floor(seq / 3)) % TEMPLATES.length];
  return {
    ...template,
    seq,
    id: `preview-${seq}`,
    sessionId: "preview-session",
    timestamp: new Date(BASE_MS + seq * 700).toISOString(),
  };
}

function matchesInput(event: PagedDiagnosticEvent, input: DiagnosticsPageInput, needle: string): boolean {
  if (input.since !== undefined && event.seq <= input.since) return false;
  if (input.level !== undefined && event.level !== input.level) return false;
  if (input.source !== undefined && event.source !== input.source) return false;
  if (!needle) return true;
  return `${event.category} ${event.message} ${event.correlationId ?? ""} ${String(event.metadata?.method ?? "")} ${String(event.metadata?.path ?? "")}`
    .toLowerCase()
    .includes(needle);
}

/** Same contract as `diagnostics_page`: newest first, `after` takes the nearest
 *  matches above the cursor, `before` the nearest below it, and filters apply to the
 *  whole history rather than to the returned page. */
export function selectTracePage(events: PagedDiagnosticEvent[], input: DiagnosticsPageInput): DiagnosticsPage {
  const limit = Math.min(input.limit ?? TRACE_PAGE, TRACE_LOADED_CAP);
  const needle = input.query?.trim().toLowerCase() ?? "";
  const matched = events.filter((event) => matchesInput(event, input, needle));
  const total = matched.length;

  if (input.after !== undefined) {
    const found = matched.findIndex((event) => event.seq > (input.after as number));
    const start = found === -1 ? total : found;
    const end = Math.min(start + limit, total);
    return {
      events: matched.slice(start, end).reverse(),
      headSeq: events.at(-1)?.seq ?? 0,
      hasNewer: end < total,
      hasOlder: start > 0,
      matchingTotal: total,
      matchingAfter: total - start,
    };
  }

  const found = input.before === undefined ? -1 : matched.findIndex((event) => event.seq >= (input.before as number));
  const end = found === -1 ? total : found;
  const start = Math.max(0, end - limit);
  return {
    events: matched.slice(start, end).reverse(),
    headSeq: events.at(-1)?.seq ?? 0,
    hasNewer: end < total,
    hasOlder: start > 0,
    matchingTotal: total,
    matchingAfter: null,
  };
}

export function createTraceFixture() {
  const events: PagedDiagnosticEvent[] = [];
  let nextSeq = 1;
  const append = () => {
    events.push(fixtureEvent(nextSeq));
    if (events.length > TRACE_FIXTURE_CAPACITY) events.shift();
    return nextSeq++;
  };
  for (let index = 0; index < TRACE_FIXTURE_GENERATED; index++) append();
  return {
    page: async (input: DiagnosticsPageInput) => selectTracePage(events, input),
    start(onChanged: (seq: number) => void) {
      const timer = window.setInterval(() => onChanged(append()), 700);
      return () => window.clearInterval(timer);
    },
  };
}

export type DebugTraceFixture = ReturnType<typeof createTraceFixture>;
