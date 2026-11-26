import { notFound } from "next/navigation";
import { getPool } from "@/lib/db/pool";
import { resolveWorkOsPageAccess } from "@/lib/work-os-page-access";
import { currentPayrollWindowForDate } from "@wrazy/work-os-shared/payroll/window";
import PayrollReview from "@/modules/work-os/admin/payroll/PayrollReview";
import { isPayrollDate, isPayrollPayDate } from "@/modules/work-os/admin/payroll/paths";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function currentPayDate(): string {
  return currentPayrollWindowForDate(new Date().toISOString().slice(0, 10)).payDate;
}

export default async function PayrollReviewPage({ params, searchParams }: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ payDate?: string | string[]; reviewId?: string | string[]; from?: string | string[]; through?: string | string[] }>;
}) {
  const { personId } = await params;
  const { payDate, reviewId, from, through } = await searchParams;
  const access = await resolveWorkOsPageAccess();
  if (!access.ok || access.access.role !== "admin" || !UUID.test(personId)) notFound();
  const reviewFilter = typeof reviewId === "string" && UUID.test(reviewId) ? reviewId : null;
  if (reviewId !== undefined && !reviewFilter) notFound();
  const fromDate = isPayrollDate(from) ? from : undefined;
  const throughDate = isPayrollDate(through) ? through : undefined;
  if ((from !== undefined || through !== undefined) && (!fromDate || !throughDate)) notFound();
  if (payDate !== undefined && !isPayrollPayDate(payDate)) notFound();
  const windowKey = !reviewFilter && fromDate && throughDate ? `${fromDate}_${throughDate}` : null;
  const { rows } = await getPool().query<{ id: string | null; pay_date: string | null; display_name: string }>(`SELECT r.id,r.pay_date::text,p.display_name
    FROM work_people p JOIN work_payroll_settings s ON s.organization_id=p.organization_id AND s.enabled
    LEFT JOIN LATERAL (
      SELECT r.id,r.pay_date,r.period_end,r.window_key FROM work_payroll_reviews r
      WHERE r.organization_id=p.organization_id AND r.person_id=p.id
        AND r.retention_expires_at > now()
        AND ($3::uuid IS NULL OR r.id=$3::uuid)
        AND ($4::text IS NULL OR r.window_key=$4)
        AND ($5::date IS NULL OR r.pay_date=$5::date)
      ORDER BY r.pay_date DESC, (r.status='approved') DESC, r.period_end DESC, r.period_start, r.updated_at DESC LIMIT 1
    ) r ON true
    WHERE p.organization_id=$1 AND p.id=$2`,
  [access.access.organizationId, personId, reviewFilter, windowKey, reviewFilter || windowKey ? null : (isPayrollPayDate(payDate) ? payDate : null)]);
  const entry = rows[0];
  if (!entry || ((reviewFilter || windowKey) && !entry.id)) notFound();
  const chosenPayDate = entry.pay_date ?? (isPayrollPayDate(payDate) ? payDate : undefined) ?? currentPayDate();
  return <PayrollReview
    key={`${personId}:${entry.id ?? `${chosenPayDate}:${fromDate ?? ""}:${throughDate ?? ""}`}`}
    reviewId={entry.id} personId={personId} displayName={entry.display_name} payDate={chosenPayDate}
    initialFrom={fromDate} initialThrough={throughDate} />;
}
