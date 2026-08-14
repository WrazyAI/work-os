import { invoke, isTauri } from "@tauri-apps/api/core";
import { newEventId, redactValue, type DiagnosticEvent, type DiagnosticLevel, type DiagnosticSource, type IncomingDiagnosticEvent } from "./redact";

export type { DiagnosticEvent, DiagnosticLevel, DiagnosticSource };

function emit(event: IncomingDiagnosticEvent) {
  const payload: IncomingDiagnosticEvent = {
    ...event,
    id: event.id ?? newEventId(),
    timestamp: event.timestamp ?? new Date().toISOString(),
    metadata: event.metadata ? redactValue(event.metadata) as Record<string, unknown> : undefined,
  };
  if (!isTauri()) return;
  void invoke("diagnostics_emit", { event: payload }).catch(() => undefined);
}

export const diagnostics = {
  info(category: string, message: string, metadata?: Record<string, unknown>, extra?: Partial<IncomingDiagnosticEvent>) {
    emit({ category, message, level: "info", source: extra?.source ?? "frontend", metadata, ...extra });
  },
  warn(category: string, message: string, metadata?: Record<string, unknown>, extra?: Partial<IncomingDiagnosticEvent>) {
    emit({ category, message, level: "warn", source: extra?.source ?? "frontend", metadata, ...extra });
  },
  error(category: string, message: string, metadata?: Record<string, unknown>, extra?: Partial<IncomingDiagnosticEvent>) {
    emit({ category, message, level: "error", source: extra?.source ?? "frontend", metadata, ...extra });
  },
  async withSpan<T>(category: string, action: () => Promise<T>, metadata?: Record<string, unknown>, source: DiagnosticSource = "frontend") {
    const correlationId = newEventId();
    const started = performance.now();
    emit({ category: `${category}.started`, message: category, level: "info", source, correlationId, metadata });
    try {
      const result = await action();
      emit({ category: `${category}.completed`, message: category, level: "info", source, correlationId, durationMs: Math.round(performance.now() - started), metadata });
      return result;
    } catch (error) {
      emit({
        category: `${category}.failed`,
        message: error instanceof Error ? error.message : "Operation failed",
        level: "error",
        source,
        correlationId,
        durationMs: Math.round(performance.now() - started),
        metadata: { ...metadata, errorName: error instanceof Error ? error.name : "unknown" },
      });
      throw error;
    }
  },
};

export function installDiagnosticErrorHandlers() {
  window.addEventListener("error", (event) => {
    diagnostics.error("react.unhandled_error", event.message || "Unhandled error", { filename: event.filename, lineno: event.lineno });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "Rejected");
    diagnostics.error("promise.unhandled_rejection", reason);
  });
}

export async function diagnosticsSnapshot() {
  if (!isTauri()) return [] as DiagnosticEvent[];
  return invoke<DiagnosticEvent[]>("diagnostics_snapshot");
}

export async function exportDiagnostics(extras?: { runtimeHealth?: Record<string, unknown>; queueSummary?: Record<string, unknown>; sanitizedConfig?: Record<string, unknown> }) {
  return invoke<string>("diagnostics_export", { extras: extras ?? {} });
}

export async function openLogsDir() {
  return invoke<string>("open_logs_dir");
}

export async function openDebuggerWindow() {
  await invoke("open_debug_window");
}
