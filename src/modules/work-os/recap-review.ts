/** Browser-safe recap provenance vocabulary. Server, web and companion render
 * the same words so an automatic payroll approval can never read as an
 * employee confirmation. This module imports nothing and performs no IO. */

export type RecapReviewStatus = "inferred" | "confirmed" | "amended";
export type RecapReviewSource = "employee" | "admin" | "payroll_auto";

export function recapReviewSource(status: unknown, source: unknown): RecapReviewSource | null {
  if (status !== "confirmed" && status !== "amended") return null;
  if (source === "employee" || source === "admin" || source === "payroll_auto") return source;
  // Historical reviews predate the source column; they were employee actions.
  return "employee";
}

export function recapReviewLabel(status: unknown, source: unknown = undefined): string {
  if (status === "inferred") return "AI-inferred, not reviewed";
  if (status !== "confirmed" && status !== "amended") return "AI-inferred, not reviewed";
  const resolved = recapReviewSource(status, source);
  if (resolved === "payroll_auto") return "Auto-approved for payroll";
  if (resolved === "admin") return status === "amended" ? "Corrected by administrator" : "Approved by administrator";
  return status === "amended" ? "Corrected by employee" : "Confirmed by employee";
}

export function isEmployeeReviewedRecap(status: unknown, source: unknown = undefined): boolean {
  return (status === "confirmed" || status === "amended") && recapReviewSource(status, source) === "employee";
}

/** Whether a review may start the employee next-step proposal flow. Only an
 * employee's own confirmation/correction qualifies; payroll automation and an
 * administrator review are approvals, not employee input. */
export function nextStepsRecapEligible(status: unknown, source: unknown = undefined): boolean {
  return isEmployeeReviewedRecap(status, source);
}

export function recapReviewActor(status: unknown, source: unknown = undefined): "employee" | "administrator" | "system" | "nobody" {
  const resolved = recapReviewSource(status, source);
  if (!resolved) return "nobody";
  return resolved === "payroll_auto" ? "system" : resolved === "admin" ? "administrator" : "employee";
}

/** The notice shown wherever a payroll-auto recap appears. The pay date is
 * already resolved in the employee's timezone by the caller. */
export function payrollRecapNotice(payDate: string): string {
  const text = String(payDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error("payroll notice requires a YYYY-MM-DD payment date");
  }
  return `Auto-approved for payroll on ${text} because the payroll cutoff passed. This is a system approval, not an employee confirmation. You can still add a correction.`;
}

/** The one line a reviewed recap's spoken script uses to name who approved it.
 * Employee reviews keep the existing script with no extra provenance line. */
export function recapSpeechProvenanceLine(status: unknown, source: unknown = undefined): string | null {
  const resolved = recapReviewSource(status, source);
  if (resolved === "payroll_auto") return "Auto-approved for payroll. This is a system approval, not an employee confirmation.";
  if (resolved === "admin") return status === "amended" ? "Corrected by an administrator." : "Approved by an administrator.";
  return null;
}

export function recapCoverageLine(status: unknown, source: unknown = undefined): string {
  const resolved = recapReviewSource(status, source);
  if (resolved === "payroll_auto") {
    return "AI-inferred activity, auto-approved for payroll; a system decision, not employee confirmation or task completion/attendance.";
  }
  if (resolved === "admin") return "AI-inferred activity, approved by an administrator; not task completion or attendance.";
  return "AI-inferred activity, employee reviewed; not task completion or attendance.";
}

export function payrollDateKey(value: unknown): string | null {
  if (value == null) return null;
  const text = value instanceof Date
    ? (Number.isFinite(value.getTime()) ? value.toISOString() : "")
    : String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/** Compatibility projection for immutable snapshots written before
 * `reviewSource`/`payrollDate` existed. Returns a copy; never rewrites history. */
export function normalizeReviewedRecap<T extends {
  reviewStatus: "confirmed" | "amended"; reviewSource?: RecapReviewSource;
  payrollDate?: string | null;
}>(recap: T): T & { reviewSource: RecapReviewSource; payrollDate: string | null } {
  return {
    ...recap,
    reviewSource: recap.reviewSource ?? "employee",
    payrollDate: recap.payrollDate ?? null,
  };
}
