import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  COMPLETION_EVIDENCE_ACCEPT,
  COMPLETION_EVIDENCE_MAX_BYTES,
  COMPLETION_EVIDENCE_MAX_NOTE,
  CompletionEvidenceError,
  assertCompletionEvidenceBytes,
  completionEvidenceDisposition,
  completionEvidenceObjectPath,
  completionEvidencePreviewKind,
  completionEvidenceTypeLabel,
  isEmployeeAttachedEvidence,
  sanitizeCompletionEvidenceFileName,
  taskEvidenceFromRow,
  taskRequiresCompletionEvidence,
  validateCompletionEvidenceUpload,
} from "../src/modules/work-os/completion-evidence.ts";
import { isTaskOutcomeEvidence } from "../src/modules/work-os/companion.ts";

const root = new URL("../", import.meta.url);
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

test("completion evidence accepts one bounded file of a supported type", () => {
  const valid = validateCompletionEvidenceUpload({
    contentType: "image/png",
    fileName: "release-check.png",
    size: 2048,
    note: "  Signed build verified.  ",
  });
  assert.equal(valid.contentType, "image/png");
  assert.equal(valid.extension, "png");
  assert.equal(valid.fileName, "release-check.png");
  assert.equal(valid.note, "Signed build verified.");
});

test("completion evidence rejects empty, oversized, and unsupported uploads", () => {
  assert.throws(() => validateCompletionEvidenceUpload({ contentType: "image/png", fileName: "a.png", size: 0 }), CompletionEvidenceError);
  assert.throws(() => validateCompletionEvidenceUpload({ contentType: "image/png", fileName: "a.png", size: COMPLETION_EVIDENCE_MAX_BYTES + 1 }), /8 MB or smaller/);
  assert.throws(() => validateCompletionEvidenceUpload({ contentType: "text/html", fileName: "a.html", size: 12 }), /PNG, JPEG, WebP, PDF/);
  assert.throws(() => validateCompletionEvidenceUpload({
    contentType: "text/plain",
    fileName: "a.txt",
    size: 12,
    note: "x".repeat(COMPLETION_EVIDENCE_MAX_NOTE + 1),
  }), /characters or fewer/);
});

test("generic browser types fall back to the file name, while a real type wins", () => {
  assert.equal(validateCompletionEvidenceUpload({ contentType: "", fileName: "notes.md", size: 4 }).contentType, "text/markdown");
  assert.equal(validateCompletionEvidenceUpload({ contentType: "application/octet-stream", fileName: "rows.csv", size: 4 }).contentType, "text/csv");
  assert.equal(validateCompletionEvidenceUpload({ contentType: "text/plain", fileName: "image.png", size: 4 }).contentType, "text/plain");
  assert.throws(() => validateCompletionEvidenceUpload({ contentType: "image/svg+xml", fileName: "image.svg", size: 4 }), CompletionEvidenceError);
});

test("Word and archive types map to canonical MIME types and extensions", () => {
  assert.equal(COMPLETION_EVIDENCE_ACCEPT, ".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.markdown,.csv,.doc,.docx,.zip,.7z");
  const cases = [
    ["application/msword", "legacy-report.doc", "doc"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "release-checklist.docx", "docx"],
    ["application/zip", "installer-logs.zip", "zip"],
    ["application/x-7z-compressed", "build-output.7z", "7z"],
  ] as const;
  for (const [contentType, fileName, extension] of cases) {
    const valid = validateCompletionEvidenceUpload({ contentType, fileName, size: 64 });
    assert.equal(valid.contentType, contentType);
    assert.equal(valid.extension, extension);
    assert.equal(valid.fileName, fileName);
  }
  assert.equal(
    validateCompletionEvidenceUpload({ contentType: "application/x-zip-compressed", fileName: "logs.zip", size: 64 }).contentType,
    "application/zip",
  );
  assert.equal(
    validateCompletionEvidenceUpload({ contentType: "application/octet-stream", fileName: "release.docx", size: 64 }).contentType,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(validateCompletionEvidenceUpload({ contentType: "", fileName: "archive.7z", size: 64 }).extension, "7z");
});

test("the preview matrix keeps readable media inline and containers as downloads", () => {
  assert.equal(completionEvidencePreviewKind("image/png"), "image");
  assert.equal(completionEvidencePreviewKind("application/pdf"), "pdf");
  assert.equal(completionEvidencePreviewKind("text/plain"), "text");
  assert.equal(completionEvidencePreviewKind("text/markdown"), "markdown");
  assert.equal(completionEvidencePreviewKind("text/csv"), "spreadsheet");
  assert.equal(completionEvidencePreviewKind("application/msword"), "word");
  assert.equal(completionEvidencePreviewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "word");
  assert.equal(completionEvidencePreviewKind("application/zip"), "archive");
  assert.equal(completionEvidencePreviewKind("application/x-7z-compressed"), "archive");
  assert.equal(completionEvidencePreviewKind("image/svg+xml"), "unsupported");

  assert.equal(completionEvidenceTypeLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "Word document (.docx)");
  assert.equal(completionEvidenceTypeLabel("application/zip"), "ZIP archive");
  assert.equal(completionEvidenceTypeLabel("application/x-7z-compressed"), "7Z archive");

  for (const type of ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv"]) {
    assert.equal(completionEvidenceDisposition(type), "inline", type);
  }
  for (const type of ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/x-7z-compressed", "text/html"]) {
    assert.equal(completionEvidenceDisposition(type), "attachment", type);
  }
});

test("completion evidence bytes must match the declared type", () => {
  assert.doesNotThrow(() => assertCompletionEvidenceBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"));
  assert.throws(() => assertCompletionEvidenceBytes(new TextEncoder().encode("not a png"), "image/png"), /PNG image/);
  assert.doesNotThrow(() => assertCompletionEvidenceBytes(new TextEncoder().encode("%PDF-1.7\n"), "application/pdf"));
  assert.throws(() => assertCompletionEvidenceBytes(new TextEncoder().encode("plain"), "application/pdf"), /PDF/);
  assert.doesNotThrow(() => assertCompletionEvidenceBytes(new TextEncoder().encode("hello\nworld"), "text/plain"));
  assert.throws(() => assertCompletionEvidenceBytes(new Uint8Array([0x68, 0x00, 0x69]), "text/plain"), /binary data/);
  assert.throws(() => assertCompletionEvidenceBytes(new Uint8Array([0xff, 0xfe]), "text/plain"), /UTF-8/);
});

test("Word and archive magic bytes reject a contradictory declaration", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const zip = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);
  const emptyZip = bytes(0x50, 0x4b, 0x05, 0x06, 0x00, 0x00);
  const zip7z = bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c);
  const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

  assert.doesNotThrow(() => assertCompletionEvidenceBytes(ole, "application/msword"));
  assert.throws(() => assertCompletionEvidenceBytes(zip, "application/msword"), /Word \.doc/);
  assert.doesNotThrow(() => assertCompletionEvidenceBytes(zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
  assert.throws(() => assertCompletionEvidenceBytes(emptyZip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), /Word \.docx/);
  assert.throws(() => assertCompletionEvidenceBytes(ole, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), /Word \.docx/);
  assert.doesNotThrow(() => assertCompletionEvidenceBytes(zip, "application/zip"));
  assert.doesNotThrow(() => assertCompletionEvidenceBytes(emptyZip, "application/zip"));
  assert.throws(() => assertCompletionEvidenceBytes(ole, "application/zip"), /ZIP archive/);
  assert.doesNotThrow(() => assertCompletionEvidenceBytes(zip7z, "application/x-7z-compressed"));
  assert.throws(() => assertCompletionEvidenceBytes(zip, "application/x-7z-compressed"), /7Z archive/);
});

test("object paths are org, person, and task scoped and cannot traverse", () => {
  const path = completionEvidenceObjectPath({
    organizationId: uuid(1),
    personId: uuid(2),
    taskId: uuid(3),
    evidenceId: uuid(4),
    contentType: "application/pdf",
  });
  assert.equal(path, `completion-evidence/${uuid(1)}/${uuid(2)}/${uuid(3)}/${uuid(4)}.pdf`);
  assert.throws(() => completionEvidenceObjectPath({
    organizationId: "../outside",
    personId: uuid(2),
    taskId: uuid(3),
    evidenceId: uuid(4),
    contentType: "application/pdf",
  }), /Invalid completion evidence organization/);
});

test("file names are reduced to a safe display name", () => {
  assert.equal(sanitizeCompletionEvidenceFileName("../../secret/report.pdf", "application/pdf"), "report.pdf");
  assert.equal(sanitizeCompletionEvidenceFileName("bad\u0000name\n.pdf", "application/pdf"), "badname.pdf");
  assert.equal(sanitizeCompletionEvidenceFileName("", "image/png"), "completion-evidence.png");
});

test("only tasks that promise an outcome require completion evidence", () => {
  assert.equal(taskRequiresCompletionEvidence({ expected_outcome: "Ship the signed installer" }), true);
  assert.equal(taskRequiresCompletionEvidence({ definition_of_done: "Reviewer can reproduce the flow" }), true);
  assert.equal(taskRequiresCompletionEvidence({ expected_outcome: "   ", definition_of_done: null }), false);
  assert.equal(taskRequiresCompletionEvidence({ title: "Simple task" }), false);
});

test("employee-attached rows are output evidence and never expose their storage path", () => {
  const row = {
    id: uuid(5),
    title: "Ship drawer — completion evidence",
    summary: "The signed verification record.",
    source: "manual",
    created_at: "2026-10-21T16:42:00.000Z",
    metrics: {
      evidenceClass: "output_evidence",
      employeeAttached: true,
      origin: "task_completion",
      contentType: "application/pdf",
      fileName: "release-verification.pdf",
      sizeBytes: 482112,
      note: "The signed verification record.",
      storagePath: "/private/should-not-leak.pdf",
    },
    raw: { storagePath: "/private/should-not-leak.pdf" },
  };
  const evidence = taskEvidenceFromRow(row);
  assert.equal(evidence.url, `/api/work-os/evidence/${uuid(5)}/file`);
  assert.equal(evidence.fileName, "release-verification.pdf");
  assert.equal(evidence.sizeBytes, 482112);
  assert.equal(evidence.note, "The signed verification record.");
  assert.equal(JSON.stringify(evidence).includes("should-not-leak"), false);
  assert.equal(taskEvidenceFromRow({ ...row, metrics: { ...row.metrics, note: undefined } }).note, "", "a generated summary is never shown as the employee's note");
  assert.equal(isEmployeeAttachedEvidence(row), true);
  assert.equal(isTaskOutcomeEvidence(row), true);
  assert.equal(isEmployeeAttachedEvidence({ ...row, source: "github" }), false);
  assert.equal(isEmployeeAttachedEvidence({ ...row, metrics: { evidenceClass: "activity_observation" } }), false);
});

test("the evidence route and server path keep their truthful contract", async () => {
  const route = await readFile(new URL("src/app/api/work-os/me/tasks/[taskId]/completion-evidence/route.ts", root), "utf8");
  const fileRoute = await readFile(new URL("src/app/api/work-os/evidence/[eventId]/file/route.ts", root), "utf8");
  const server = await readFile(new URL("src/lib/work-os-employee-tasks.ts", root), "utf8");
  const adminEvidence = await readFile(new URL("src/app/api/work-os/evidence/route.ts", root), "utf8");
  const eod = await readFile(new URL("src/lib/work-os-eod.ts", root), "utf8");
  assert.match(route, /requirePerson: true/);
  assert.match(route, /feature: "employee_companion"/);
  assert.match(route, /formData\(\)/);
  assert.match(route, /idempotency_key/);
  assert.match(route, /attachWorkOsTaskCompletionEvidence/);
  assert.match(route, /setWorkOsEmployeeTaskCompletion/);
  assert.match(fileRoute, /COMPLETION_EVIDENCE_BUCKET/);
  assert.match(fileRoute, /requireWorkOsPersonAccess/);
  assert.match(fileRoute, /X-Content-Type-Options/);
  assert.match(fileRoute, /completionEvidenceDisposition/);
  assert.match(fileRoute, /"Content-Disposition": `\$\{disposition\}/);
  assert.match(server, /taskRequiresCompletionEvidence/);
  assert.match(server, /evidence_required/);
  assert.match(server, /getStorageBackend\(\)\.upload/);
  assert.match(server, /getStorageBackend\(\)\.remove/);
  assert.match(server, /completionEvidence/);
  assert.doesNotMatch(route, /storagePath|storage_path/);
  // The evidence row reaches the existing admin and EOD reads unchanged.
  assert.match(adminEvidence, /from\("work_evidence"\)/);
  assert.match(eod, /source !== "worktivity"/);
});

test("completion evidence errors carry actionable codes", () => {
  assert.throws(
    () => validateCompletionEvidenceUpload({ contentType: "image/png", fileName: "a.png", size: COMPLETION_EVIDENCE_MAX_BYTES + 1 }),
    (error) => error instanceof CompletionEvidenceError && error.code === "file_too_large",
  );
  assert.throws(
    () => validateCompletionEvidenceUpload({ contentType: "text/html", fileName: "a.html", size: 4 }),
    (error) => error instanceof CompletionEvidenceError && error.code === "unsupported_file_type",
  );
  assert.throws(
    () => assertCompletionEvidenceBytes(new TextEncoder().encode("not a png"), "image/png"),
    (error) => error instanceof CompletionEvidenceError && error.code === "unsupported_file_type",
  );
});
