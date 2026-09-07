import { useEffect, useState } from "react";
import { Check, ChevronDown, Sparkles } from "lucide-react";

/** One assistant work stage. Stages are driven by the real request lifecycle —
 * only stages that actually started are rendered. */
export interface AvatarThinkingStage {
  label: string;
  detail?: string;
}

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

/** Expandable assistant trace for the avatar window. While work is in flight
 * the trace stays open with a shimmer header and live elapsed timer; once
 * settled it collapses to a one-line receipt that remains expandable. */
export function AvatarThinking({
  stages,
  active,
  startedAt,
  settledMs,
  result,
  activeLabel = "Thinking",
}: {
  stages: AvatarThinkingStage[];
  /** Index of the in-flight stage, or -1 once settled. */
  active: number;
  startedAt: number;
  /** Total time once settled; omit while working. */
  settledMs?: number;
  /** One-line outcome shown after settling, e.g. "Reviewed 4 tasks". */
  result?: string;
  activeLabel?: string;
}) {
  const working = active >= 0;
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const expanded = manualExpanded ?? working;
  const visible = working ? stages.slice(0, Math.min(stages.length, active + 1)) : stages;

  // 100ms ticks keep the 0.1s readout honest. State lives here (not in the
  // chat tree) so each tick re-renders only this trace; the timer itself is
  // aria-hidden so screen readers announce the status once, not every tick.
  useEffect(() => {
    if (!working) return;
    setElapsed(Date.now() - startedAt);
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, [working, startedAt]);

  return (
    <div className="avatar-thinking">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? working))}
        className="avatar-thinking-head"
      >
        <Sparkles size={13} aria-hidden="true" />
        <span role="status">
          {working ? (
            <span className="avatar-thinking-active">{activeLabel}</span>
          ) : (
            <span className="avatar-thinking-done">
              {settledMs !== undefined ? `Thought for ${formatElapsed(settledMs)}` : "Thought"}
              {result ? ` · ${result}` : ""}
            </span>
          )}
        </span>
        {working && (
          <span className="avatar-thinking-elapsed" aria-hidden="true">
            {formatElapsed(elapsed)}
          </span>
        )}
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={`avatar-thinking-chevron ${expanded ? "open" : ""}`}
        />
      </button>
      <div
        className="avatar-thinking-trace-wrap"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
      >
        <div className="avatar-thinking-trace-clip">
          <div className="avatar-thinking-trace">
            {visible.map((stage, index) => {
              const done = !working || index < active;
              return (
                <div key={`${index}-${stage.label}`} className="avatar-thinking-row">
                  {done ? (
                    <Check size={13} aria-hidden="true" className="avatar-thinking-check" />
                  ) : (
                    <span aria-hidden="true" className="avatar-thinking-spinner" />
                  )}
                  <span className="avatar-thinking-label">{stage.label}</span>
                  {stage.detail && <span className="avatar-thinking-detail">{stage.detail}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
