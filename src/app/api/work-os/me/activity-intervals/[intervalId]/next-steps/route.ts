import { NextResponse } from "next/server";
import { dismissRecapNextSteps, listRecapNextSteps } from "@/lib/work-os-next-steps";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: "employee_companion",
  });
}

/** The mascot chat's next-steps moment reads the suggestions generated for one
 * approved recap: generation status plus each item's current decision state. */
export async function GET(req: Request, { params }: { params: Promise<{ intervalId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { intervalId } = await params;
    return NextResponse.json(
      await listRecapNextSteps(auth.access, intervalId),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

/** Ends the chat moment: every still-undecided suggestion for this recap is
 * dismissed so it never re-appears and nothing lingers in a queue. */
export async function POST(req: Request, { params }: { params: Promise<{ intervalId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { intervalId } = await params;
    const body = await req.json().catch(() => ({})) as { action?: unknown };
    if (body.action !== "dismiss") {
      return NextResponse.json({ error: "action must be dismiss" }, { status: 400 });
    }
    const dismissed = await dismissRecapNextSteps(auth.access, intervalId);
    return NextResponse.json({ dismissed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
