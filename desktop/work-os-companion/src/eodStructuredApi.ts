import { apiRequest, apiRequestRaw, sendOrQueue } from "./api";
import type { EodCompositionInput } from "./eodStructured";

function stoppedError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("The summary stopped responding. Try again.");
}

async function readBodyChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw stoppedError(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(stoppedError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export type EodStructuredWriteResult = {
  report?: Record<string, unknown>;
  queued?: true;
};

/** The seven fields the report PATCH owns. Suggestions and evidence stay
 * server-owned and are never sent back by the composer. */
export function eodSavePayload(input: EodCompositionInput): Record<string, unknown> {
  return {
    completed: input.completed ?? [],
    inProgress: input.inProgress ?? [],
    next: input.next ?? [],
    summary: input.summary ?? "",
    summaryGeneratedAt: input.summaryGeneratedAt ?? null,
    summarySource: input.summarySource ?? null,
    summarySignature: input.summarySignature ?? null,
    loomUrl: input.loomUrl ?? null,
  };
}

export function eodSubmitPayload(input: EodCompositionInput, key: string): Record<string, unknown> {
  return { structured: input, submission_idempotency_key: key };
}

/** Silent fallback for today's draft when the scheduler has not prepared it.
 * Historical drafts are never converted by the companion. */
export async function prepareStructuredEod(date: string): Promise<{ report: Record<string, unknown> }> {
  return apiRequest<{ report: Record<string, unknown> }>("/api/work-os/me/eod/prepare", {
    method: "POST",
    body: JSON.stringify({ date }),
  });
}

export async function saveStructuredEod(reportId: string, input: EodCompositionInput): Promise<EodStructuredWriteResult> {
  const result = await sendOrQueue(
    `/api/work-os/reports/${encodeURIComponent(reportId)}`,
    "PATCH",
    eodSavePayload(input),
  );
  return result as EodStructuredWriteResult;
}

export async function submitStructuredEod(reportId: string, input: EodCompositionInput, key: string): Promise<EodStructuredWriteResult> {
  const result = await sendOrQueue(
    `/api/work-os/reports/${encodeURIComponent(reportId)}/submit`,
    "PATCH",
    eodSubmitPayload(input, key),
  );
  return result as EodStructuredWriteResult;
}

/** Streams the opening paragraph for one report day. The date is part of the
 * request: a historical structured draft must be grounded in that day, never
 * in today's record. */
export async function streamEodSummary(
  date: string,
  input: EodCompositionInput,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<{ source: "otto" | "assembled" }> {
  const response = await apiRequestRaw("/api/work-os/me/eod/summary", {
    method: "POST",
    body: JSON.stringify({
      date,
      completed: input.completed ?? [],
      inProgress: input.inProgress ?? [],
      next: input.next ?? [],
    }),
    signal,
  }, { timeoutMs: 60_000 });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = "The summary could not be written. Try again.";
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) message = parsed.error;
    } catch {
      const raw = body.trim();
      if (raw) message = raw.startsWith("<") ? "The summary could not be written. Try again." : raw.slice(0, 240);
    }
    throw new Error(message);
  }
  const source = response.headers.get("X-Work-OS-Summary-Source") === "assembled" ? "assembled" : "otto";
  if (!response.body) throw new Error("The summary came back empty. Try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const bodyAbort = new AbortController();
  const onAbort = () => bodyAbort.abort(signal.reason);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => bodyAbort.abort(new Error("The summary stopped responding. Try again.")), 60_000);
  try {
    while (true) {
      const { done, value } = await readBodyChunk(reader, bodyAbort.signal);
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) onChunk(text);
    }
    const tail = decoder.decode();
    if (tail) onChunk(tail);
    return { source };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    try { reader.releaseLock(); } catch { /* the reader may already be cancelled */ }
  }
}
