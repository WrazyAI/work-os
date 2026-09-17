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
  hours: [
    { hourStart: 14, label: "2–3 PM", summary: "Repository review and component work in Chrome and VS Code.", frameCount: 2, summaryId: "preview-shot-2", visibleApp: "VS Code", synthesized: true },
    { hourStart: 16, label: "4–5 PM", summary: "Pull request checks and stylesheet changes across Chrome and VS Code.", frameCount: 2, summaryId: "preview-shot-5", visibleApp: "VS Code", synthesized: true },
    { hourStart: 18, label: "6–7 PM", summary: "Terminal test output and the repository page in the browser.", frameCount: 2, summaryId: "preview-shot-9", visibleApp: "Google Chrome", synthesized: true },
  ],
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
  hours: [
    { hourStart: 14, label: "2–3 PM", summary: "Repository review in Chrome and VS Code.", frameCount: 2, summaryId: "preview-shot-2", visibleApp: "VS Code", synthesized: true },
  ],
};

const RESOLVE_SRC = (summaryId: string, size: "thumb" | "preview" | "full") => {
  const index = FRAMES.findIndex((frame) => frame.summaryId === summaryId);
  return index < 0 ? null : shot(190 + index * 14, size === "preview" ? `Preview ${index + 1}` : `Frame ${index + 1}`);
};

/** Layout stress fixture: many frames with long, unbroken summaries so the
 * accordion, rows, and carousel are exercised at their widest. */
const STRESS_SUMMARY = "A desktop screenshot visibly shows several overlapping developer windows with a browser-based review interface, a terminal containing long localhost output, and a task panel; the specific application identity and task state are unclear because much of the on-screen text is small and partially obscured by other windows.";
const STRESS_FRAMES = Array.from({ length: 24 }, (_, index) => ({
  summaryId: `stress-shot-${index + 1}`,
  capturedAt: `2026-09-14T${String(8 + Math.floor(index / 3)).padStart(2, "0")}:${String((index % 3) * 19).padStart(2, "0")}:00.000Z`,
  visibleApp: ["Google Chrome", "VS Code", "Windows Terminal Host", "OpenCode Desktop"][index % 4]!,
  summary: `${STRESS_SUMMARY} Frame ${index + 1}.`,
  confidence: 0.95,
}));
const STRESS_GALLERY: EodScreenshotGallery = {
  processed: 24,
  excludedPolicy: 0,
  excludedSensitive: 117,
  unavailable: 0,
  pending: 0,
  total: 24,
  viewable: STRESS_FRAMES,
};
const STRESS_CONTEXT = {
  processed: 24,
  excluded: 117,
  failed: 0,
  pending: 0,
  hours: Array.from({ length: 8 }, (_, index) => ({
    hourStart: 8 + index,
    label: `${8 + index > 12 ? 8 + index - 12 : 8 + index} ${8 + index < 12 ? "AM" : "PM"}–${9 + index > 12 ? 9 + index - 12 : 9 + index} ${9 + index < 12 ? "AM" : "PM"}`,
    summary: STRESS_SUMMARY,
    frameCount: 3,
    summaryId: `stress-shot-${index * 3 + 1}`,
    visibleApp: ["Google Chrome", "VS Code", "Windows Terminal Host", "OpenCode Desktop"][index % 4]!,
    synthesized: false,
  })),
};
const STRESS_RESOLVE_SRC = (summaryId: string, size: "thumb" | "preview" | "full") => {
  const index = STRESS_FRAMES.findIndex((frame) => frame.summaryId === summaryId);
  return index < 0 ? null : shot(150 + index * 7, size === "preview" ? `Stress ${index + 1}` : `Frame ${index + 1}`);
};

export default function EodPreview() {
  const params = new URLSearchParams(window.location.search);
  const allTasksCompleted = params.has("all-complete");
  const refiningPreview = params.has("refining");
  const shotsPreview = params.has("shots");
  const stressPreview = params.has("shots-stress");
  const pendingPreview = params.has("shots-pending");
  const [draftedAnyway, setDraftedAnyway] = useState(false);
  const waitingPreview = pendingPreview && !draftedAnyway;
  const draftBottleneckPreview = params.has("draft-bottleneck");
  const loomPreview = params.has("loom");
  const [markdown, setMarkdown] = useState(draftBottleneckPreview ? `${draft}\n\n## Bottleneck\nWaiting on the security review before the release can ship.` : draft);
  const [submitted, setSubmitted] = useState(false);
  return <div className="workspace preview-workspace"><section className="stage"><header className="masthead"><div><p>September 2</p><h1>EOD review</h1></div></header><main className="page">
    {submitted ? <section className="panel eod-submitted" role="status"><Otto pose="celebrate" className="otto-celebrate" /><strong>EOD submitted</strong><p>Your report is with your manager. You are done for today.</p></section> : <EodComposer reportId="preview-eod" initialMarkdown={markdown} source="ai" suggestedBottleneck={draftBottleneckPreview ? null : "A pending approval delayed the final handoff."} allTasksCompleted={allTasksCompleted} redrafting={refiningPreview} busy={false} screenshotContext={stressPreview ? STRESS_CONTEXT : shotsPreview ? SCREENSHOT_CONTEXT : null} screenshotGallery={stressPreview ? STRESS_GALLERY : shotsPreview ? SCREENSHOT_GALLERY : null} screenshotResolveSrc={stressPreview ? STRESS_RESOLVE_SRC : shotsPreview ? RESOLVE_SRC : undefined} screenshotSyncUnavailable={params.has("shots-unavailable")} loomEnabled={loomPreview} onLoomPreview={async () => ({ title: "Settlement walkthrough", durationSeconds: 326, createdLocalDate: "2026-09-14", verdict: "same_day", usableForDay: true, metadataAvailable: true })} onLoomDraft={async () => ({ ok: true })} onRedraft={() => setMarkdown(draft)} onRefine={async (_current, feedback, annotations) => { setMarkdown(`${draft}\n\n## Notes\n- Refined from employee feedback: ${feedback || "(none)"}${annotations.length ? ` (+ ${annotations.length} notes)` : ""}`); return true; }} onSubmit={(final) => { setMarkdown(final); setSubmitted(true); }} />}
  </main></section></div>;
}
