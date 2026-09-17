import { useState } from "react";
import { EodComposer } from "./taskSurfaces";
import { Otto } from "./Otto";
import type { EodScreenshotGallery } from "./types";

const draft = "## Summary\nCompleted the release checks and documented the results for review.\n\n## Completed\n- Verify the EOD refinement flow\n\n## Carried forward\n- Nothing pending";

const shot = (hue: number, label: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="hsl(${hue} 28% 24%)"/><rect x="12" y="14" width="296" height="172" rx="8" fill="hsl(${hue} 32% 38%)"/><text x="24" y="42" fill="rgba(255,255,255,.86)" font-family="sans-serif" font-size="15">${label}</text></svg>`)}`;

const FRAMES = [
  { summaryId: "preview-shot-1", capturedAt: "2026-09-14T14:02:00.000Z", visibleApp: "Google Chrome", summary: "A GitHub repository page for the work-os project is visible.", confidence: 0.99 },
  { summaryId: "preview-shot-2", capturedAt: "2026-09-14T14:48:00.000Z", visibleApp: "VS Code", summary: "An editor shows the EOD composer component with tests open beside it.", confidence: 0.97 },
  { summaryId: "preview-shot-3", capturedAt: "2026-09-14T15:21:00.000Z", visibleApp: "Windows Terminal Host", summary: "A terminal window shows a passing test run.", confidence: 0.98 },
  { summaryId: "preview-shot-4", capturedAt: "2026-09-14T16:05:00.000Z", visibleApp: "Google Chrome", summary: "A pull request review page shows an approved check suite.", confidence: 0.96 },
  { summaryId: "preview-shot-5", capturedAt: "2026-09-14T16:44:00.000Z", visibleApp: "VS Code", summary: "A diff view shows stylesheet changes for the screenshot gallery.", confidence: 0.95 },
  { summaryId: "preview-shot-6", capturedAt: "2026-09-14T17:12:00.000Z", visibleApp: "Nifty", summary: "A task board shows the in-progress workstream for the day.", confidence: 0.93 },
  { summaryId: "preview-shot-7", capturedAt: "2026-09-14T17:55:00.000Z", visibleApp: "Google Chrome", summary: "A dashboard page shows the deployment status as healthy.", confidence: 0.94 },
  { summaryId: "preview-shot-8", capturedAt: "2026-09-14T18:21:26.068Z", visibleApp: "Windows Terminal Host", summary: "A dark terminal window is visible in front of a browser showing test output.", confidence: 0.98 },
  { summaryId: "preview-shot-9", capturedAt: "2026-09-14T18:30:27.095Z", visibleApp: "Google Chrome", summary: "A browser window visibly shows a GitHub repository page for the work-os project.", confidence: 0.99 },
];

const SCREENSHOT_GALLERY: EodScreenshotGallery = {
  processed: 9,
  excludedPolicy: 0,
  excludedSensitive: 69,
  unavailable: 0,
  pending: 0,
  total: 9,
  viewable: FRAMES,
};

const SCREENSHOT_CONTEXT = {
  processed: 9,
  excluded: 69,
  failed: 0,
  pending: 0,
  observations: FRAMES.slice(-4).map(({ summaryId, capturedAt, summary, visibleApp, confidence }) => ({ summaryId, capturedAt, summary, visibleApp, confidence })),
};

const PENDING_GALLERY: EodScreenshotGallery = {
  processed: 3,
  excludedPolicy: 0,
  excludedSensitive: 0,
  unavailable: 0,
  pending: 6,
  total: 9,
  viewable: FRAMES.slice(0, 3),
};

const PENDING_CONTEXT = {
  processed: 3,
  excluded: 0,
  failed: 0,
  pending: 6,
  observations: FRAMES.slice(0, 3).map(({ summaryId, capturedAt, summary, visibleApp, confidence }) => ({ summaryId, capturedAt, summary, visibleApp, confidence })),
};

const RESOLVE_SRC = (summaryId: string, size: "thumb" | "preview" | "full") => {
  const index = FRAMES.findIndex((frame) => frame.summaryId === summaryId);
  return index < 0 ? null : shot(190 + index * 14, size === "preview" ? `Preview ${index + 1}` : `Frame ${index + 1}`);
};

export default function EodPreview() {
  const params = new URLSearchParams(window.location.search);
  const allTasksCompleted = params.has("all-complete");
  const refiningPreview = params.has("refining");
  const shotsPreview = params.has("shots");
  const pendingPreview = params.has("shots-pending");
  const [draftedAnyway, setDraftedAnyway] = useState(false);
  const waitingPreview = pendingPreview && !draftedAnyway;
  const draftBottleneckPreview = params.has("draft-bottleneck");
  const [markdown, setMarkdown] = useState(draftBottleneckPreview ? `${draft}\n\n## Bottleneck\nWaiting on the security review before the release can ship.` : draft);
  const [submitted, setSubmitted] = useState(false);
  return <div className="workspace preview-workspace"><section className="stage"><header className="masthead"><div><p>September 2</p><h1>EOD review</h1></div></header><main className="page">
    {submitted ? <section className="panel eod-submitted" role="status"><Otto pose="celebrate" className="otto-celebrate" /><strong>EOD submitted</strong><p>Your report is with your manager. You are done for today.</p></section> : <EodComposer reportId="preview-eod" initialMarkdown={markdown} source="ai" suggestedBottleneck={draftBottleneckPreview ? null : "A pending approval delayed the final handoff."} allTasksCompleted={allTasksCompleted} redrafting={refiningPreview} busy={false} screenshotContext={pendingPreview ? PENDING_CONTEXT : shotsPreview ? SCREENSHOT_CONTEXT : null} screenshotGallery={pendingPreview ? PENDING_GALLERY : shotsPreview ? SCREENSHOT_GALLERY : null} screenshotResolveSrc={shotsPreview || pendingPreview ? RESOLVE_SRC : undefined} screenshotSyncUnavailable={params.has("shots-unavailable")} preparing={waitingPreview ? { analyzed: 3, total: 9, pending: 6 } : null} onDraftAnyway={waitingPreview ? () => setDraftedAnyway(true) : undefined} onRedraft={() => setMarkdown(draft)} onRefine={async (_current, feedback, annotations) => { setMarkdown(`${draft}\n\n## Notes\n- Refined from employee feedback: ${feedback || "(none)"}${annotations.length ? ` (+ ${annotations.length} notes)` : ""}`); return true; }} onSubmit={(final) => { setMarkdown(final); setSubmitted(true); }} />}
  </main></section></div>;
}
