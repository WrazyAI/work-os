import PayrollOverview from "@/modules/work-os/admin/payroll/PayrollOverview";
import { isPayrollPayDate } from "@/modules/work-os/admin/payroll/paths";

export default async function PayrollOverviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const tab = query.tab === "audits" ? "audits" : "records";
  const initialPayDate = isPayrollPayDate(query.payDate) ? query.payDate : undefined;
  return <PayrollOverview key={`${tab}:${initialPayDate ?? ""}`} tab={tab} newAudit={tab === "audits" && query.new === "1"} initialPayDate={initialPayDate} />;
}
