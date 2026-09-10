import { useState } from "react";
import { EodComposer } from "./taskSurfaces";
import { Otto } from "./Otto";

const draft = "## Summary\nCompleted the release checks and documented the results for review.\n\n## Completed\n- Verify the EOD refinement flow\n\n## Carried forward\n- Nothing pending";

export default function EodPreview() {
  const allTasksCompleted = new URLSearchParams(window.location.search).has("all-complete");
  const refiningPreview = new URLSearchParams(window.location.search).has("refining");
  const [markdown, setMarkdown] = useState(draft);
  const [submitted, setSubmitted] = useState(false);
  return <div className="workspace preview-workspace"><section className="stage"><header className="masthead"><div><p>September 2</p><h1>EOD review</h1></div></header><main className="page">
    {submitted ? <section className="panel eod-submitted" role="status"><Otto pose="celebrate" className="otto-celebrate" /><strong>EOD submitted</strong><p>Your report is with your manager. You are done for today.</p></section> : <EodComposer reportId="preview-eod" initialMarkdown={markdown} source="ai" suggestedBottleneck="A pending approval delayed the final handoff." allTasksCompleted={allTasksCompleted} redrafting={refiningPreview} busy={false} onRedraft={() => setMarkdown(draft)} onRefine={async (_current, feedback, annotations) => { setMarkdown(`${draft}\n\n## Notes\n- Refined from employee feedback: ${feedback || "(none)"}${annotations.length ? ` (+ ${annotations.length} notes)` : ""}`); return true; }} onSubmit={(final) => { setMarkdown(final); setSubmitted(true); }} />}
  </main></section></div>;
}
