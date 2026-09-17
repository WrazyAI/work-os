import { NextResponse } from "next/server";
import { listEodScreenshots } from "@/lib/work-os-screenshots";
import { ensureHourlyScreenshotSummaries } from "@/lib/work-os-screenshot-hours";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "screenshot_summaries",
    });
    if (auth.response) return auth.response;
    const date = new URL(req.url).searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    const personId = auth.access.personId as string;
    const [gallery, hours] = await Promise.all([
      listEodScreenshots(auth.access.organizationId, personId, date),
      ensureHourlyScreenshotSummaries({ organizationId: auth.access.organizationId, personId, date }),
    ]);
    return NextResponse.json({ ...gallery, hours });
  } catch (error) {
    return jsonError(error);
  }
}
