import { after, NextResponse } from "next/server";
import { activityIntervalCardView, ensureActivityInterval } from "@/lib/work-os-activity-intervals";
import { ensureRecapNextSteps } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ensures the Activity Interval Review for the currently due progress prompt.
 * The client only identifies the prompt slot; the server resolves the
 * authoritative session, window, and evidence. Idempotent per slot.
 *
 * After the response is flushed, one stale recap-approved next-step pass is
 * drained in the background, so a confirmed recap generates its suggestions
 * even if the attempt right after the decision never ran. The interval row's
 * claim and stale-claim recovery make the drain safe to repeat. */
export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
cadenceMinutes: req.headers.get("x-work-os-cadence-minutes"),
firstFollowUpMinutes: req.headers.get("x-work-os-first-follow-up-minutes"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = await req.json().catch(() => ({})) as { prompt_due_at?: unknown };
    const result = await ensureActivityInterval(auth.access, {
      promptDueAt: typeof body.prompt_due_at === "string" ? body.prompt_due_at : undefined,
    });
    after(() => ensureRecapNextSteps(auth.access, 1).catch(() => 0));
    return NextResponse.json({
      status: result.status,
      reason: result.reason ?? null,
      interval: result.interval ? activityIntervalCardView(result.interval) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
