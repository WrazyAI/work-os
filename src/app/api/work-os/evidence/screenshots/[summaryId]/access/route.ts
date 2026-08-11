import { NextResponse } from "next/server";
import { accessWorkOsScreenshot } from "@/lib/work-os-screenshots";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ summaryId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      feature: "screenshot_summaries",
    });
    if (auth.response) return auth.response;
    const { summaryId } = await params;
    const body = await req.json();
    const reason = typeof body.reason === "string" ? body.reason : "";
    return NextResponse.json(await accessWorkOsScreenshot(auth.access, summaryId, reason));
  } catch (error) {
    return jsonError(error);
  }
}
