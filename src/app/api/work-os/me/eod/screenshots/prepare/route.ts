import { NextResponse } from "next/server";
import { prepareEodScreenshots } from "@/lib/work-os-screenshots";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Runs one small, bounded Worktivity analysis batch for the caller's own EOD
 * day. The composer calls this after pressing Draft while frames remain, shows
 * the waiting state with honest counts, and offers drafting anyway with the
 * frames that are already analyzed. */
export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "screenshot_summaries",
    });
    if (auth.response) return auth.response;
    const body = await req.json().catch(() => ({}));
    const date = typeof (body as { date?: unknown })?.date === "string" ? (body as { date: string }).date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    const requestedFrames = Number((body as { max_frames?: unknown })?.max_frames ?? 6);
    const preparation = await prepareEodScreenshots(
      { organizationId: auth.access.organizationId },
      auth.access.personId as string,
      date,
      { maxScreenshots: Number.isFinite(requestedFrames) ? requestedFrames : 6 },
    );
    return NextResponse.json(preparation);
  } catch (error) {
    return jsonError(error);
  }
}
