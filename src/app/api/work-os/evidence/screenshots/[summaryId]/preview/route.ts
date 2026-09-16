import { NextResponse } from "next/server";
import { previewWorkOsScreenshot, type ScreenshotPreviewSize } from "@/lib/work-os-screenshots";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ summaryId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      feature: "screenshot_summaries",
    });
    if (auth.response) return auth.response;
    const { summaryId } = await params;
    const requested = new URL(req.url).searchParams.get("size");
    const size: ScreenshotPreviewSize = requested === "preview" || requested === "full" ? requested : "thumb";
    const image = await previewWorkOsScreenshot(auth.access, summaryId, size);
    return new NextResponse(new Uint8Array(image.bytes), {
      headers: { "Content-Type": image.contentType, "Cache-Control": "private, max-age=600" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
