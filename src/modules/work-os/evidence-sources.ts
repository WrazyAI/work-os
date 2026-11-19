/** The evidence sources an administrator can filter to. `ghl` is a first-class
 * source: recorded GoHighLevel actions are provider evidence, not a preview. */
export const EVIDENCE_SOURCE_OPTIONS: Array<{ value: string; label: string; disabled?: boolean }> = [
  { value: "worktivity", label: "Worktivity (activity)" },
  { value: "github", label: "GitHub" },
  { value: "ghl", label: "GoHighLevel" },
  { value: "loom", label: "Loom" },
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Agent" },
  { value: "nifty", label: "Legacy import" },
  { value: "crm", label: "CRM" },
  { value: "media", label: "Media" },
];

const SOURCE_LABELS: Record<string, string> = {
  worktivity: "Worktivity (activity)",
  github: "GitHub",
  ghl: "GoHighLevel",
  loom: "Loom",
  manual: "Manual",
  agent: "Agent",
  nifty: "Legacy import",
  crm: "CRM",
  media: "Media",
};

/** One source name everywhere: the summary, row, and detail never disagree. */
export function evidenceSourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? (source || "Unknown source");
}
