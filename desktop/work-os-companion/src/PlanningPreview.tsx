import { useState } from "react";
import { PlanningSession, type PlanningInterpretation } from "./PlanningSession";

const draft: PlanningInterpretation = {
  buildId: "preview-build",
  rawIntent: "Improve Work OS ease of use and refine the LaunchLoom template designs.",
  summary: "Improve Work OS ease of use and refine LaunchLoom template designs through focused review and documented changes.",
  commitments: [
    {
      clientId: "ease", title: "Improve Work OS ease of use", objective: "Identify and resolve the highest-impact usability friction in the current workday flow.", successCriteria: ["Review key flows for unnecessary steps", "Document the proposed changes for review"], sourceRefs: [{ provider: "employee", type: "intent", id: "raw_intent" }], confidence: 0.9,
    },
    {
      clientId: "templates", title: "Refine LaunchLoom template designs", objective: "Make the most-used template patterns clearer, more consistent, and easier to reuse.", successCriteria: ["Review the current template structure", "Record the next design decisions"], sourceRefs: [{ provider: "employee", type: "intent", id: "raw_intent" }], confidence: 0.86,
    },
  ],
  clarifications: [],
  readiness: "ready",
};

export default function PlanningPreview() {
  const params = new URLSearchParams(window.location.search);
  const slow = params.has("slow");
  const loomSlow = params.has("loom-slow");
  const [open, setOpen] = useState(true);
  return <main className="planning-preview"><PlanningSession
    open={open}
    plan={{ id: "preview-plan", status: "draft", freeform_intent: params.has("loom-only") ? "" : draft.rawIntent, shift_date: "2026-09-08", revision: 1, items: [] }}
    active
    busy={false}
    loomEnabled={params.has("loom")}
    onLoomPreview={async () => { if (loomSlow) await new Promise((resolve) => setTimeout(resolve, 1200)); return { title: "Settlement walkthrough", durationSeconds: 326, createdLocalDate: "2026-09-08", verdict: "same_day", usableForDay: true, metadataAvailable: true }; }}
    onClose={() => setOpen(false)}
    onInterpret={async () => { if (slow) await new Promise((resolve) => setTimeout(resolve, 2600)); return draft; }}
    onRefine={async (input, current) => ({ ...current, buildId: "preview-refined-build", rawIntent: input })}
    onConfirm={async () => "confirmed"}
  /></main>;
}
