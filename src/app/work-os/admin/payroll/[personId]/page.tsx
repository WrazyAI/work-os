import PayrollReview from "@/modules/work-os/admin/payroll/PayrollReview";

export default async function PayrollReviewPage({ params, searchParams }: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ payDate?: string }>;
}) {
  const { personId } = await params;
  const { payDate } = await searchParams;
  return <PayrollReview personId={personId} payDate={payDate ?? ""} />;
}
