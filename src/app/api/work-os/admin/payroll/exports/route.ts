import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";
import { createPayrollExport } from "@/lib/work-os-payroll-exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const approvalIds = Array.isArray(body.approval_ids) ? body.approval_ids.filter((id): id is string => typeof id === "string") : [];
    const kind = body.kind === "daily" ? "daily" : body.kind === "summary" ? "summary" : null;
    if (!kind) return NextResponse.json({ error: "kind must be summary or daily" }, { status: 400 });
    const exportFile = await createPayrollExport(auth.access, {
      approvalIds, kind, requestKey: typeof body.request_key === "string" ? body.request_key : "",
    }, new Date());
    return new NextResponse(Buffer.from(exportFile.bytes), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFile.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) { return jsonError(error); }
}
