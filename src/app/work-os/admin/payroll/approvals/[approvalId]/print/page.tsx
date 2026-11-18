import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireWorkOsAdmin } from "@/lib/work-os-api";
import { loadPayrollPrint } from "@/lib/work-os-payroll-exports";
import { PayrollPrint } from "@/modules/work-os/admin/payroll/PayrollPrint";

export const dynamic = "force-dynamic";

export default async function PayrollPrintPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const requestHeaders = await headers();
  const auth = await requireWorkOsAdmin(requestHeaders.get("x-work-os-organization-id"), requestHeaders.get("authorization"));
  if ("response" in auth) notFound();
  const { approvalId } = await params;
  const approval = await loadPayrollPrint(auth.access, approvalId).catch(() => null);
  if (!approval) notFound();
  return <PayrollPrint approval={approval} />;
}
