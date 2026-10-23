import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskEvidenceDialog, TaskEvidenceList } from "./CompletionEvidence";
import { EvidencePreviewBody, EvidencePreviewDialog, EvidenceSelectionPreview, EvidenceTypeTile } from "./EvidencePreview";
import type { TaskEvidenceRecord } from "../../../src/modules/work-os/completion-evidence";

const evidence: TaskEvidenceRecord = {
  id: "evidence-1",
  title: "Ship drawer — completion evidence",
  note: "Signed verification record.",
  fileName: "release-verification.pdf",
  contentType: "application/pdf",
  sizeBytes: 482112,
  createdAt: "2026-08-21T16:42:00.000Z",
  url: "/api/work-os/evidence/evidence-1/file",
};

const imageEvidence: TaskEvidenceRecord = {
  ...evidence,
  id: "evidence-image",
  fileName: "completion-screen.png",
  contentType: "image/png",
};

const typeEvidence: TaskEvidenceRecord[] = [
  evidence,
  { ...evidence, id: "evidence-markdown", fileName: "verification-notes.md", contentType: "text/markdown", sizeBytes: 4096 },
  { ...evidence, id: "evidence-docx", fileName: "release-checklist.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 18432 },
  { ...evidence, id: "evidence-doc", fileName: "legacy-report.doc", contentType: "application/msword", sizeBytes: 9216 },
  { ...evidence, id: "evidence-zip", fileName: "installer-logs.zip", contentType: "application/zip", sizeBytes: 1248512 },
  { ...evidence, id: "evidence-7z", fileName: "build-output.7z", contentType: "application/x-7z-compressed", sizeBytes: 3905536 },
];

const task = { id: "task-1", provider: "local", title: "Ship the drawer", completed: false };
const loadEvidence = async () => new Blob([]);

const attach = async () => ({ outcome: "completed" as const, evidence });
const noop = () => undefined;

function dialog(overrides: Partial<Parameters<typeof TaskEvidenceDialog>[0]> = {}) {
  return renderToStaticMarkup(createElement(TaskEvidenceDialog, {
    task,
    onAttach: attach,
    onRetryCompletion: async () => ({ completed: true }),
    onCompleteWithoutEvidence: async () => ({ completed: true }),
    onClose: noop,
    ...overrides,
  }));
}

describe("completion evidence dialog", () => {
  it("states that evidence is optional for a simple task", () => {
    const markup = dialog();
    expect(markup).toContain("This is optional.");
    expect(markup).toContain("Complete without evidence");
    expect(markup).toContain("Attach &amp; complete");
    expect(markup).toContain("Saved as employee-attached evidence");
    expect(markup).toContain("not a provider confirmation");
    expect(markup).toContain("Word, text, Markdown, CSV, ZIP, or 7Z");
  });

  it("requires evidence when the task records an expected outcome", () => {
    const markup = dialog({ task: { ...task, expected_outcome: "A signed verification record." } });
    expect(markup).toContain("This task records an expected outcome, so completion needs a file.");
    expect(markup).not.toContain("Complete without evidence");
    expect(markup).toContain("Expected outcome");
  });

  it("keeps the chosen file and retry action after a failed upload", () => {
    const markup = dialog({
      initialPhase: "failed",
      initialError: "The connection dropped before the file was saved.",
      initialFileName: "release-verification.pdf",
    });
    expect(markup).toContain("The connection dropped before the file was saved.");
    expect(markup).toContain("release-verification.pdf");
    expect(markup).toContain("Try again");
  });

  it("shows saved evidence without claiming completion", () => {
    const markup = dialog({
      initialPhase: "evidence_saved",
      initialEvidence: evidence,
      initialError: "Evidence saved. The task is not marked complete yet.",
    });
    expect(markup).toContain("Evidence saved — task not complete yet");
    expect(markup).toContain("Retry completion");
    expect(markup).toContain("release-verification.pdf");
    expect(markup).toContain("Employee-attached");
  });

  it("confirms completion only with the saved evidence named", () => {
    const markup = dialog({ initialPhase: "done", initialEvidence: evidence });
    expect(markup).toContain("Task complete");
    expect(markup).toContain("Evidence attached to this completed task");
    expect(markup).toContain("release-verification.pdf");
    expect(markup).toContain("Done");
    expect(markup).not.toContain("Attach &amp; complete");
  });

  it("offers an attach-only path for an already completed task", () => {
    const markup = dialog({ mode: "attach", initialFileName: "release-verification.pdf" });
    expect(markup).toContain("Attach evidence");
    expect(markup).not.toContain("Complete without evidence");
    expect(markup).not.toContain("Attach &amp; complete");
  });
});

describe("task drawer evidence list", () => {
  it("names employee-attached provenance and offers the file", () => {
    const markup = renderToStaticMarkup(createElement(TaskEvidenceList, {
      evidence: [evidence],
      loadEvidence,
      completed: true,
      onAttach: noop,
      onDownload: noop,
    }));
    expect(markup).toContain("Completion evidence");
    expect(markup).toContain("release-verification.pdf");
    expect(markup).toContain("PDF document");
    expect(markup).toContain("Employee-attached");
    expect(markup).toContain("Signed verification record.");
    expect(markup).toContain("Preview release-verification.pdf");
    expect(markup).toContain("Download release-verification.pdf");
    expect(markup).toContain("Attach evidence");
  });

  it("keeps a completed task without evidence honest", () => {
    const markup = renderToStaticMarkup(createElement(TaskEvidenceList, {
      evidence: [],
      loadEvidence,
      completed: true,
      readOnly: true,
    }));
    expect(markup).toContain("No completion evidence was attached.");
    expect(markup).not.toContain("Attach evidence");
  });

  it("carries a distinct type tile for every supported non-image type", () => {
    const markup = renderToStaticMarkup(createElement(TaskEvidenceList, {
      evidence: typeEvidence,
      loadEvidence,
      completed: true,
      onDownload: noop,
    }));
    expect(markup).toContain("PDF document");
    expect(markup).toContain("Markdown file");
    expect(markup).toContain("Word document (.docx)");
    expect(markup).toContain("Word document (.doc)");
    expect(markup).toContain("ZIP archive");
    expect(markup).toContain("7Z archive");
    expect(markup).toContain("kind-word");
    expect(markup).toContain("kind-archive");
    expect(markup).toContain(">DOCX<");
    expect(markup).toContain(">ZIP<");
    expect(markup).toContain(">7Z<");
  });

  it("shows a loading thumbnail for an image before the authenticated blob resolves", () => {
    const markup = renderToStaticMarkup(createElement(TaskEvidenceList, {
      evidence: [imageEvidence],
      loadEvidence,
      completed: true,
      onDownload: noop,
    }));
    expect(markup).toContain("evidence-thumb is-loading");
    expect(markup).toContain("PNG image");
    expect(markup).not.toContain("<img");
  });
});

describe("evidence preview states", () => {
  it("reserves a loading state with a live status", () => {
    const markup = renderToStaticMarkup(createElement(EvidencePreviewBody, { evidence, state: { status: "loading" } }));
    expect(markup).toContain("Loading preview…");
    expect(markup).toContain('role="status"');
  });

  it("explains a corrupt or missing file and keeps the download path", () => {
    const markup = renderToStaticMarkup(createElement(EvidencePreviewDialog, {
      evidence,
      loadEvidence,
      onDownload: noop,
      onClose: noop,
    }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Close evidence preview");
    expect(markup).toContain("Loading preview…");
    expect(markup).toContain("Download");
  });

  it("renders an error state without claiming the file is available", () => {
    const markup = renderToStaticMarkup(createElement(EvidencePreviewBody, {
      evidence,
      state: { status: "error", message: "The evidence file could not be found." },
    }));
    expect(markup).toContain("Preview unavailable");
    expect(markup).toContain("The evidence file could not be found.");
    expect(markup).toContain("Download it to open it in its native app.");
  });

  it("renders readable text and markdown without raw HTML execution", () => {
    const text = renderToStaticMarkup(createElement(EvidencePreviewBody, {
      evidence,
      state: { status: "text", text: "plain notes", truncated: false, markdown: false },
    }));
    expect(text).toContain("<pre>plain notes</pre>");

    const markdown = renderToStaticMarkup(createElement(EvidencePreviewBody, {
      evidence,
      state: { status: "text", text: "# Notes\n\n- shipped", truncated: true, markdown: true },
    }));
    expect(markdown).toContain("<h2>Notes</h2>");
    expect(markdown).toContain("Preview truncated at 200 KB");
  });

  it("gives Word and archives a metadata preview with a download-only explanation", () => {
    const word = renderToStaticMarkup(createElement(EvidencePreviewBody, {
      evidence: { ...evidence, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "release-checklist.docx" },
      state: { status: "metadata" },
    }));
    expect(word).toContain("Word document (.docx)");
    expect(word).toContain("downloads the document without extracting it here");
    expect(word).toContain("release-checklist.docx");

    const archive = renderToStaticMarkup(createElement(EvidencePreviewBody, {
      evidence: { ...evidence, contentType: "application/zip", fileName: "installer-logs.zip" },
      state: { status: "metadata" },
    }));
    expect(archive).toContain("ZIP archive");
    expect(archive).toContain("Archives are not extracted in the app.");
  });

  it("uses an accessible image and PDF preview surface", () => {
    const image = renderToStaticMarkup(createElement(EvidencePreviewBody, {
      evidence: imageEvidence,
      state: { status: "image", url: "blob:evidence-image" },
    }));
    expect(image).toContain('src="blob:evidence-image"');
    expect(image).toContain('alt="Preview of completion-screen.png"');

    const pdf = renderToStaticMarkup(createElement(EvidencePreviewBody, {
      evidence,
      state: { status: "pdf", url: "blob:evidence-pdf" },
    }));
    expect(pdf).toContain("<iframe");
    expect(pdf).toContain('title="PDF preview: release-verification.pdf"');
    expect(pdf).toContain("download it to open it in your PDF viewer");
  });
});

describe("evidence selection preview", () => {
  it("names the chosen type before submit", () => {
    const markup = renderToStaticMarkup(createElement(EvidenceSelectionPreview, {
      file: new File(["# Notes"], "verification-notes.md", { type: "text/markdown" }),
    }));
    expect(markup).toContain("verification-notes.md");
    expect(markup).toContain("Markdown file");
    expect(markup).toContain("completion-evidence-selection");
  });

  it("uses a distinct tile for each type family", () => {
    expect(renderToStaticMarkup(createElement(EvidenceTypeTile, { kind: "word", fileName: "a.docx" }))).toContain(">DOCX<");
    expect(renderToStaticMarkup(createElement(EvidenceTypeTile, { kind: "archive", contentType: "application/x-7z-compressed", fileName: "a.7z" }))).toContain(">7Z<");
    expect(renderToStaticMarkup(createElement(EvidenceTypeTile, { kind: "spreadsheet", fileName: "a.csv" }))).toContain(">CSV<");
  });
});
