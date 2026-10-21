import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskEvidenceDialog, TaskEvidenceList } from "./CompletionEvidence";
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

const task = { id: "task-1", provider: "local", title: "Ship the drawer", completed: false };

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
      completed: true,
      onAttach: noop,
      onDownload: noop,
    }));
    expect(markup).toContain("Completion evidence");
    expect(markup).toContain("release-verification.pdf");
    expect(markup).toContain("Employee-attached");
    expect(markup).toContain("Signed verification record.");
    expect(markup).toContain("Download release-verification.pdf");
    expect(markup).toContain("Attach evidence");
  });

  it("keeps a completed task without evidence honest", () => {
    const markup = renderToStaticMarkup(createElement(TaskEvidenceList, {
      evidence: [],
      completed: true,
      readOnly: true,
    }));
    expect(markup).toContain("No completion evidence was attached.");
    expect(markup).not.toContain("Attach evidence");
  });
});
