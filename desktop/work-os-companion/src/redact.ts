export type DiagnosticLevel = "trace" | "debug" | "info" | "warn" | "error";
export type DiagnosticSource = "frontend" | "rust" | "ipc" | "sync" | "storage";

export interface DiagnosticEvent {
  id: string;
  timestamp: string;
  level: DiagnosticLevel;
  source: DiagnosticSource;
  category: string;
  message: string;
  sessionId: string;
  correlationId?: string;
  spanId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface IncomingDiagnosticEvent {
  id?: string;
  timestamp?: string;
  level?: DiagnosticLevel;
  source?: DiagnosticSource;
  category: string;
  message: string;
  sessionId?: string;
  correlationId?: string;
  spanId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

const SENSITIVE = /token|authorization|cookie|password|verifier|stronghold|input.?text|transcript|email|bearer|secret/i;

export function redactString(value: string) {
  if (/bearer\s+/i.test(value)) return "[redacted]";
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => (
      SENSITIVE.test(key) ? [key, "[redacted]"] : [key, redactValue(child)]
    )));
  }
  if (typeof value === "string") return redactString(value);
  return value;
}

export function newEventId() {
  return crypto.randomUUID();
}
