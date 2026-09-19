import { ArrowUpRight, ChevronRight } from "lucide-react";
import type { NavigatePage } from "./interpretation";
import "./tool-approval-card.css";

const PAGE_LABELS: Record<NavigatePage, string> = {
  day: "Today",
  tasks: "Tasks",
  review: "Review & EOD",
  insights: "Insights",
  evidence: "Evidence",
  settings: "Settings",
};

/** Inline assistant navigation shortcut. Moving between pages mutates
 * nothing, so it runs immediately — it never enters the approval queue. */
export function NavigateButton({ page, statement, onNavigate }: {
  page: NavigatePage;
  statement?: string;
  onNavigate: (page: NavigatePage) => void;
}) {
  return (
    <button
    type="button"
    className="navigate-button"
    title={statement || `Open ${PAGE_LABELS[page]}`}
    aria-label={`Open ${PAGE_LABELS[page]}`}
    data-workos-tool-surface="navigation"
    data-workos-tool-state="ready"
    onClick={() => onNavigate(page)}
  >
      <span className="navigate-button-icon" aria-hidden="true"><ArrowUpRight size={15} /></span>
      <span className="navigate-button-copy"><small>Shortcut</small><span>Open {PAGE_LABELS[page]}</span></span>
      <ChevronRight size={16} className="navigate-button-arrow" aria-hidden="true" />
    </button>
  );
}
