import { NextResponse } from "next/server";
import { summarizeWorktivityScreenshots } from "@/lib/work-os-screenshots";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      feature: "screenshot_summaries",
    });
    if (auth.response) return auth.response;
    const body = await req.json();
    const personId = auth.access.role === "employee" ? auth.access.personId : body.person_id;
    if (!personId) return NextResponse.json({ error: "person_id is required" }, { status: 400 });
    const denied = await requireWorkOsPersonAccess(auth.access, personId);
    if (denied) return denied;
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    return NextResponse.json(await summarizeWorktivityScreenshots(auth.access, personId, date));
  } catch (error) {
    return jsonError(error);
  }
}
