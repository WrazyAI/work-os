/**
 * Completion evidence is the one file (plus an optional note) an employee
 * attaches to their own task when they mark it done. It is explicitly
 * employee-authored output evidence — never a Worktivity screenshot, never a
 * provider confirmation, and never a completion claim by itself.
 *
 * This module stays browser-safe: the companion renders the same limits and
 * validation the server enforces, and the server remains authoritative.
 */

export const COMPLETION_EVIDENCE_BUCKET = "work-evidence";
export const COMPLETION_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;
export const COMPLETION_EVIDENCE_MAX_NOTE = 1000;
export const COMPLETION_EVIDENCE_MAX_FILE_NAME = 180;
export const COMPLETION_EVIDENCE_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.markdown,.csv";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
};

const FILE_NAME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
};

export const COMPLETION_EVIDENCE_ALLOWED_TYPES = Object.keys(EXTENSIONS);

export class CompletionEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionEvidenceError";
  }
}

export type TaskEvidenceRecord = {
  id: string;
  title: string;
  note: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  /** Authenticated, person-scoped read route. Never a storage path. */
  url: string;
};

export function normalizeCompletionEvidenceType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSIONS[type] ? type : null;
}

function fileExtension(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = value.split(/[\\/]/).pop() ?? "";
  const match = /\.([a-z0-9]{1,10})$/i.exec(name);
  return match ? match[1]!.toLowerCase() : "";
}

/** Browsers often report an empty or generic type for Markdown and CSV, so
 * only those cases fall back to the file name; a real declared type wins. */
export function resolveCompletionEvidenceType(contentType: unknown, fileName: unknown): string | null {
  const declared = normalizeCompletionEvidenceType(contentType);
  if (declared) return declared;
  const raw = typeof contentType === "string" ? contentType.split(";")[0]?.trim().toLowerCase() ?? "" : "";
  if (raw && raw !== "application/octet-stream") return null;
  return FILE_NAME_TYPES[fileExtension(fileName)] ?? null;
}

export function completionEvidenceExtension(contentType: unknown): string {
  const type = normalizeCompletionEvidenceType(contentType);
  if (!type) throw new CompletionEvidenceError("Completion evidence must be a supported file type");
  return EXTENSIONS[type]!;
}

export function sanitizeCompletionEvidenceFileName(value: unknown, contentType: unknown): string {
  const extension = completionEvidenceExtension(contentType);
  const raw = typeof value === "string" ? value.split(/[\\/]/).pop() ?? "" : "";
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, COMPLETION_EVIDENCE_MAX_FILE_NAME);
  if (!cleaned || cleaned === "." || cleaned === "..") return `completion-evidence.${extension}`;
  return cleaned;
}

export function validateCompletionEvidenceUpload(input: {
  contentType?: unknown;
  fileName?: unknown;
  size?: unknown;
  note?: unknown;
}) {
  const contentType = resolveCompletionEvidenceType(input.contentType, input.fileName);
  if (!contentType) {
    throw new CompletionEvidenceError("Completion evidence must be a PNG, JPEG, WebP, PDF, text, Markdown, or CSV file");
  }
  const size = input.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    throw new CompletionEvidenceError("The evidence file must not be empty");
  }
  if (size > COMPLETION_EVIDENCE_MAX_BYTES) {
    throw new CompletionEvidenceError("The evidence file must be 8 MB or smaller");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > COMPLETION_EVIDENCE_MAX_NOTE) {
    throw new CompletionEvidenceError(`The evidence note must be ${COMPLETION_EVIDENCE_MAX_NOTE} characters or fewer`);
  }
  return {
    contentType,
    extension: completionEvidenceExtension(contentType),
    fileName: sanitizeCompletionEvidenceFileName(input.fileName, contentType),
    note,
    size,
  };
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.length <= bytes.length && signature.every((value, index) => bytes[index] === value);
}

/** Reject a file whose bytes contradict its declared type. The route also
 * sends `X-Content-Type-Options: nosniff`, but a truthful type keeps the
 * stored record and the authenticated read honest. */
export function assertCompletionEvidenceBytes(bytes: Uint8Array, contentType: string) {
  if (!bytes.length) throw new CompletionEvidenceError("The evidence file must not be empty");
  if (bytes.byteLength > COMPLETION_EVIDENCE_MAX_BYTES) {
    throw new CompletionEvidenceError("The evidence file must be 8 MB or smaller");
  }
  if (contentType === "image/png" && !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    throw new CompletionEvidenceError("The selected file does not look like a PNG image");
  }
  if (contentType === "image/jpeg" && !startsWith(bytes, [0xff, 0xd8, 0xff])) {
    throw new CompletionEvidenceError("The selected file does not look like a JPEG image");
  }
  if (contentType === "image/webp") {
    const riff = startsWith(bytes, [0x52, 0x49, 0x46, 0x46]);
    const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!riff || !webp) throw new CompletionEvidenceError("The selected file does not look like a WebP image");
  }
  if (contentType === "application/pdf" && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new CompletionEvidenceError("The selected file does not look like a PDF");
  }
  if (contentType.startsWith("text/")) {
    if (bytes.includes(0)) throw new CompletionEvidenceError("The selected text file contains binary data");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new CompletionEvidenceError("The selected text file must be UTF-8 encoded");
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string) {
  if (!UUID.test(value)) throw new CompletionEvidenceError(`Invalid completion evidence ${label}`);
}

/** Object paths are derived from trusted UUIDs only, so a stored record can
 * never point outside its organization, person, or task scope. */
export function completionEvidenceObjectPath(input: {
  organizationId: string;
  personId: string;
  taskId: string;
  evidenceId: string;
  contentType: string;
}) {
  assertUuid(input.organizationId, "organization");
  assertUuid(input.personId, "person");
  assertUuid(input.taskId, "task");
  assertUuid(input.evidenceId, "record");
  const extension = completionEvidenceExtension(input.contentType);
  return `completion-evidence/${input.organizationId}/${input.personId}/${input.taskId}/${input.evidenceId}.${extension}`;
}

export function completionEvidenceMetrics(input: {
  contentType: string;
  fileName: string;
  sizeBytes: number;
}) {
  return {
    evidenceClass: "output_evidence" as const,
    employeeAttached: true as const,
    origin: "task_completion" as const,
    contentType: input.contentType,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
  };
}

/** A task is an output task when it records the outcome it promises. Those
 * completions require an attached artifact; a simple task does not. */
export function taskRequiresCompletionEvidence(task: Record<string, unknown>) {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return Boolean(text(task.expected_outcome) || text(task.definition_of_done));
}

export function isEmployeeAttachedEvidence(row: Record<string, unknown>) {
  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics as Record<string, unknown> : {};
  return row.source === "manual" && metrics.employeeAttached === true && metrics.evidenceClass === "output_evidence";
}

export function taskEvidenceFromRow(row: Record<string, unknown>): TaskEvidenceRecord {
  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics as Record<string, unknown> : {};
  const id = String(row.id ?? "");
  const contentType = typeof metrics.contentType === "string" ? metrics.contentType : "application/octet-stream";
  const sizeBytes = Number(metrics.sizeBytes);
  return {
    id,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Completion evidence",
    note: typeof row.summary === "string" ? row.summary : "",
    fileName: typeof metrics.fileName === "string" && metrics.fileName.trim() ? metrics.fileName.trim() : "completion-evidence",
    contentType,
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    url: `/api/work-os/evidence/${encodeURIComponent(id)}/file`,
  };
}

export function formatEvidenceFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
