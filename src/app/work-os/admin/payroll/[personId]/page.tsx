import { getPool } from "@/lib/db/pool";
import { resolveWorkOsPageAccess } from "@/lib/work-os-page-access";
import PayrollReview from "@/modules/work-os/admin/payroll/PayrollReview";

function currentPayDate(): string {
  const now = new Date();
  const day = now.getUTCDate() >= 16 ? 16 : 1;
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default async function PayrollReviewPage({ params, searchParams }: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ payDate?: string }>;
}) {
  const { personId } = await params;
  const { payDate } = await searchParams;
  let fallback = "";
  const access = await resolveWorkOsPageAccess();
  if (access.ok) {
    const latest = await getPool().query(`SELECT pay_date FROM work_payroll_reviews
      WHERE organization_id=$1 AND person_id=$2 ORDER BY updated_at DESC LIMIT 1`, [access.access.organizationId, personId]);
    const value = latest.rows[0]?.pay_date;
    fallback = value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : "";
  }
  return <PayrollReview personId={personId} payDate={payDate || fallback || currentPayDate()} />;
}
