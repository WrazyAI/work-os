import type { PayrollDayResult } from "@/modules/work-os/payroll/contracts";

export function PayrollDayDialog({ day, onClose }: { day: PayrollDayResult | null; onClose: () => void }) {
  if (!day) return null;
  return (
    <div role="presentation" className="payroll-panel">
      <h2>{day.date}</h2>
      <p>Recommended {day.minutes.recommended} min · held {day.minutes.held} min</p>
      <ul>{day.findings.map((finding) => <li key={finding.key}>{finding.kind} · {finding.reason}</li>)}</ul>
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}
