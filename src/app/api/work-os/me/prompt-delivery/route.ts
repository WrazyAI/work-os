import { NextResponse } from "next/server";
import { activityIntervalSlotKey, markActivityIntervalNotified } from "@/lib/work-os-activity-intervals";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { deliverWorkdayPrompt } from "@/lib/work-os-workday";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const key = req.headers.get("idempotency-key");
    if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    const delivery = await deliverWorkdayPrompt(auth.access);
    // A delivered recap-bearing prompt is stamped once, so the Tasks stream can
    // show whether the employee was actually notified (best-effort: a missing
    // interval row must never fail prompt delivery).
    if (delivery.delivered && delivery.prompt.nextPromptAt && delivery.session) {
      await markActivityIntervalNotified(
        auth.access,
        activityIntervalSlotKey(String(delivery.session.id), delivery.prompt.nextPromptAt),
      );
    }
    return NextResponse.json({ delivered: delivery.delivered, prompt: delivery.prompt });
  } catch (error) {
    return jsonError(error);
  }
}
