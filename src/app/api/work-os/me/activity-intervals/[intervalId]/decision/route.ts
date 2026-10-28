import { after, NextResponse } from "next/server";
import { activityIntervalFullView, decideActivityInterval, type ActivityIntervalDecision } from "@/lib/work-os-activity-intervals";
import { ensureRecapNextStepsForInterval } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Employee decision on their own recap: Looks right (confirm) or add/correct
 * context (amend). The original AI inference is always preserved and nothing
 * is written to work_check_ins.
 *
 * An approved recap queues one next-step generation pass; it runs after the
 * response is flushed so the decision stays fast, and the ensure route's
 * stale-pass drain retries it if this attempt never finishes. */
export async function POST(req: Request, { params }: { params: Promise<{ intervalId: string }> }) {
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
    const { intervalId } = await params;
    const body = await req.json().catch(() => ({})) as { action?: unknown; feedback?: unknown; expectedReviewVersion?: unknown };
    const action: ActivityIntervalDecision | null = body.action === "confirm" ? "confirm" : body.action === "amend" ? "amend" : null;
    if (!action) return NextResponse.json({ error: "action must be confirm or amend" }, { status: 400 });
    if (body.expectedReviewVersion !== undefined && (typeof body.expectedReviewVersion !== "number"
      || !Number.isSafeInteger(body.expectedReviewVersion) || body.expectedReviewVersion < 0)) {
      return NextResponse.json({ error: "expectedReviewVersion must be a non-negative integer" }, { status: 400 });
    }
    const interval = await decideActivityInterval(auth.access, intervalId, {
      action,
      feedback: typeof body.feedback === "string" ? body.feedback : undefined,
      expectedReviewVersion: body.expectedReviewVersion as number | undefined,
    });
    after(() => ensureRecapNextStepsForInterval(auth.access, intervalId).catch(() => undefined));
    return NextResponse.json({ interval: await activityIntervalFullView(interval) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
