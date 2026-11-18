import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";
import { PayrollScreenshotError, previewPayrollScreenshot } from "@/lib/work-os-payroll-screenshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ reviewId: string; findingId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const { reviewId, findingId } = await context.params;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const summaryId = typeof body.summary_id === "string" ? body.summary_id : "";
    if (!summaryId) return NextResponse.json({ error: "summary_id is required" }, { status: 400 });
    const image = await previewPayrollScreenshot(auth.access, {
      reviewId, findingId, summaryId,
      reason: typeof body.reason === "string" ? body.reason : "",
      requestKey: typeof body.request_key === "string" ? body.request_key : "",
    }, new Date());
    return new NextResponse(Buffer.from(image.bytes), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    if (error instanceof PayrollScreenshotError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return jsonError(error);
  }
}
