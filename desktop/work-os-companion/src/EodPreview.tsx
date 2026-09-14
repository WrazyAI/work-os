import { useState } from "react";
import { EodComposer } from "./taskSurfaces";
import { Otto } from "./Otto";

const draft = "## Summary\nCompleted the release checks and documented the results for review.\n\n## Completed\n- Verify the EOD refinement flow\n\n## Carried forward\n- Nothing pending";

const SCREENSHOT_CONTEXT = {
  processed: 2,
  excluded: 1,
  failed: 0,
  observations: [
    { capturedAt: "2026-09-14T18:30:27.095Z", summary: "A browser window visibly shows a GitHub repository page for the work-os project.", visibleApp: "Google Chrome", confidence: 0.99 },
    { capturedAt: "2026-09-14T18:21:26.068Z", summary: "A dark terminal window is visible in front of a browser showing test output.", visibleApp: "Windows Terminal Host", confidence: 0.98 },
  ],
};

export default function EodPreview() {
  const params = new URLSearchParams(window.location.search);
  const allTasksCompleted = params.has("all-complete");
  const refiningPreview = params.has("refining");
  const shotsPreview = params.has("shots");
  const [markdown, setMarkdown] = useState(draft);
  const [submitted, setSubmitted] = useState(false);
  return <div className="workspace preview-workspace"><section className="stage"><header className="masthead"><div><p>September 2</p><h1>EOD review</h1></div></header><main className="page">
    {submitted ? <section className="panel eod-submitted" role="status"><Otto pose="celebrate" className="otto-celebrate" /><strong>EOD submitted</strong><p>Your report is with your manager. You are done for today.</p></section> : <EodComposer reportId="preview-eod" initialMarkdown={markdown} source="ai" suggestedBottleneck="A pending approval delayed the final handoff." allTasksCompleted={allTasksCompleted} redrafting={refiningPreview} busy={false} screenshotContext={shotsPreview ? SCREENSHOT_CONTEXT : null} screenshotSyncUnavailable={params.has("shots-unavailable")} onRedraft={() => setMarkdown(draft)} onRefine={async (_current, feedback, annotations) => { setMarkdown(`${draft}\n\n## Notes\n- Refined from employee feedback: ${feedback || "(none)"}${annotations.length ? ` (+ ${annotations.length} notes)` : ""}`); return true; }} onSubmit={(final) => { setMarkdown(final); setSubmitted(true); }} />}
  </main></section></div>;
}
