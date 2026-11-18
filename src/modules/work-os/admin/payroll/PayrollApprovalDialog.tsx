export function PayrollApprovalDialog({ open, approvedMinutes, onConfirm, onCancel }: {
  open: boolean; approvedMinutes: number; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Approve payroll" className="payroll-panel">
      <h2>Approve payroll</h2>
      <p>This records {approvedMinutes} approved minutes and an immutable snapshot. Later evidence requires an explicit reopen.</p>
      <button type="button" onClick={onConfirm}>Approve payable hours</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  );
}
