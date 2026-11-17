import { NextResponse } from "next/server";
import { activityIntervalSlotKey, ensureActivityInterval, markActivityIntervalNotified } from "@/lib/work-os-activity-intervals";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { deliverWorkdayPrompt } from "@/lib/work-os-workday";
import type { WorkdayPromptSlot } from "@/lib/work-os-workday";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const key = req.headers.get("idempotency-key");
    if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    let expectedSlot: WorkdayPromptSlot | undefined;
    if (body && Object.hasOwn(body, "expectedSlot")) {
      const candidate = body.expectedSlot;
      if (!candidate || typeof candidate.sessionId !== "string" || !candidate.sessionId || typeof candidate.promptDueAt !== "string" || !Number.isFinite(Date.parse(candidate.promptDueAt))) {
        return NextResponse.json({ error: "expectedSlot must identify a session and due instant" }, { status: 400 });
      }
      expectedSlot = candidate;
    }
    const at = new Date();
    const inspected = await ensureActivityInterval(auth.access, { at, expectedSlot, mode: "inspect" });
    if (!inspected.mayAdvance || !inspected.slot) return NextResponse.json({ delivered: false, prompt: null });
    const delivery = await deliverWorkdayPrompt(auth.access, at, inspected.slot);
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
