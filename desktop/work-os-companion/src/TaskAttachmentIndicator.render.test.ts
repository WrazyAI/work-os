import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { attachmentSummary, TaskAttachmentIndicator } from "./admin/TaskAttachmentIndicator";
import type { TaskEvidenceRecord } from "../../../src/modules/work-os/completion-evidence";

function evidence(overrides: Partial<TaskEvidenceRecord> = {}): TaskEvidenceRecord {
  return {
    id: "evidence-1",
    title: "Completion evidence",
    note: "",
    fileName: "verification.txt",
    contentType: "text/plain",
    sizeBytes: 1024,
    createdAt: "2026-11-05T08:00:00.000Z",
    url: "/api/work-os/evidence/evidence-1/file",
    ...overrides,
  };
}

describe("task attachment indicator", () => {
  it("names files and images in the tooltip sentence", () => {
    expect(attachmentSummary([evidence()])).toBe("1 file attached");
    expect(attachmentSummary([evidence({ id: "image", fileName: "shot.png", contentType: "image/png" })])).toBe("1 image attached");
    expect(attachmentSummary([
      evidence({ id: "file-1" }),
      evidence({ id: "file-2", fileName: "notes.md", contentType: "text/markdown" }),
      evidence({ id: "image", fileName: "shot.png", contentType: "image/png" }),
    ])).toBe("2 files and 1 image attached");
    expect(attachmentSummary([])).toBe("");
  });

  it("renders a tilted stack and an accessible name when both classes exist", () => {
    const markup = renderToStaticMarkup(createElement(TaskAttachmentIndicator, {
      attachments: [
        evidence(),
        evidence({ id: "image", fileName: "shot.png", contentType: "image/png" }),
      ],
    }));
    expect(markup).toContain('aria-label="1 file and 1 image attached"');
    expect(markup).toContain("admin-attachment-stack");
    expect(markup).toContain("admin-attachment-card is-back");
    expect(markup).toContain("admin-attachment-card is-front");
    expect(markup).toContain("lucide-file-text");
    expect(markup).toContain("lucide-image");
  });

  it("adds a bounded overflow count and renders nothing for a task without evidence", () => {
    const many = [1, 2, 3].map((index) => evidence({ id: `image-${index}`, fileName: `shot-${index}.png`, contentType: "image/png" }));
    const markup = renderToStaticMarkup(createElement(TaskAttachmentIndicator, { attachments: many }));
    expect(markup).toContain('aria-label="3 images attached"');
    expect(markup).toContain(">+1<");
    expect(renderToStaticMarkup(createElement(TaskAttachmentIndicator, { attachments: [] }))).toBe("");
  });
});
