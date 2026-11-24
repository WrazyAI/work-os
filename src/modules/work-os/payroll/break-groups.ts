import type { PayrollFinding } from "./contracts";

/** Provider break captures can arrive one minute apart with a few seconds of
 * clock drift. Group those near-adjacent persisted findings for display; the
 * underlying deductions are unchanged. */
export function groupBreakFindings(findings: PayrollFinding[], toleranceMs = 90_000): PayrollFinding[] {
  const breaks = findings.filter((finding) => finding.kind === "break" && finding.span)
    .sort((left, right) => left.span!.startMs - right.span!.startMs || left.date.localeCompare(right.date));
  const out: PayrollFinding[] = [];
  for (const finding of breaks) {
    const last = out.at(-1);
    if (last && last.date === finding.date && finding.span!.startMs - last.span!.endMs <= toleranceMs) {
      last.span = { startMs: last.span!.startMs, endMs: Math.max(last.span!.endMs, finding.span!.endMs) };
      last.minutes += finding.minutes;
      last.durationMs += finding.durationMs;
    } else {
      out.push({ ...finding, span: { ...finding.span! } });
    }
  }
  return out;
}
