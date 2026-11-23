import { notFound } from "next/navigation";
import { getPool } from "@/lib/db/pool";
import { resolveWorkOsPageAccess } from "@/lib/work-os-page-access";
import PayrollReview from "@/modules/work-os/admin/payroll/PayrollReview";
import { isPayrollPayDate } from "@/modules/work-os/admin/payroll/paths";

function currentPayDate(): string {
  const now = new Date();
  const day = now.getUTCDate() >= 16 ? 16 : 1;
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default async function PayrollReviewPage({ params, searchParams }: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ payDate?: string | string[] }>;
}) {
  const { personId } = await params;
  const { payDate } = await searchParams;
  const access = await resolveWorkOsPageAccess();
  if (!access.ok || access.access.role !== "admin" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(personId)
    || (payDate !== undefined && !isPayrollPayDate(payDate))) notFound();
  const { rows } = await getPool().query<{ id: string | null; pay_date: string | null; display_name: string }>(`SELECT r.id,r.pay_date::text,p.display_name
    FROM work_people p JOIN work_payroll_settings s ON s.organization_id=p.organization_id AND s.enabled
    LEFT JOIN LATERAL (
      SELECT id,pay_date FROM work_payroll_reviews
      WHERE organization_id=p.organization_id AND person_id=p.id AND ($3::date IS NULL OR pay_date=$3::date)
        AND retention_expires_at > now()
      ORDER BY pay_date DESC LIMIT 1
    ) r ON true
    WHERE p.organization_id=$1 AND p.id=$2`, [access.access.organizationId, personId, payDate ?? null]);
  const entry = rows[0];
  if (!entry) notFound();
  const chosenPayDate = entry.pay_date ?? payDate ?? currentPayDate();
  return <PayrollReview key={`${personId}:${chosenPayDate}`} reviewId={entry.id} personId={personId} displayName={entry.display_name} payDate={chosenPayDate} />;
}
