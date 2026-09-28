import { NextResponse } from "next/server";
import { activityIntervalCardView, ensureActivityInterval } from "@/lib/work-os-activity-intervals";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ensures the Activity Interval Review for the currently due progress prompt.
 * The client only identifies the prompt slot; the server resolves the
 * authoritative session, window, and evidence. Idempotent per slot. */
export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = await req.json().catch(() => ({})) as { prompt_due_at?: unknown };
    const result = await ensureActivityInterval(auth.access, {
      promptDueAt: typeof body.prompt_due_at === "string" ? body.prompt_due_at : undefined,
    });
    return NextResponse.json({
      status: result.status,
      reason: result.reason ?? null,
      interval: result.interval ? activityIntervalCardView(result.interval) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
