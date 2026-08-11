import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestProviderEvidence } from "@/lib/work-os-evidence";
import {
  isEmployeeOutput,
  isValidGhlWebhookSignature,
  label,
  type WorkOsWebhookJson,
} from "@/lib/work-os-provider-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!isValidGhlWebhookSignature(raw, req.headers.get("x-ghl-signature"))) {
    return NextResponse.json({ error: "invalid GHL webhook signature" }, { status: 401 });
  }
  let payload: WorkOsWebhookJson;
  try {
    payload = JSON.parse(raw) as WorkOsWebhookJson;
  } catch {
    return NextResponse.json({ error: "invalid GHL webhook payload" }, { status: 400 });
  }
  const type = String(payload.type || payload.eventType || "GHL event");
  const eventId = String(payload.webhookId || payload.id || createHash("sha256").update(raw).digest("hex"));
  const actorId = payload.userId || payload.user?.id || payload.createdBy || null;
  const objectId = payload.appointment?.id || payload.opportunity?.id || payload.contactId || payload.contact?.id || payload.task?.id || null;
  const occurredAt = payload.timestamp || payload.dateAdded || payload.createdAt || payload.updatedAt || new Date().toISOString();
  try {
    const result = await ingestProviderEvidence({
      provider: "ghl",
      externalWorkspaceIds: [payload.locationId, payload.companyId].filter(Boolean).map(String),
      externalEventId: eventId,
      externalActorId: actorId ? String(actorId) : null,
      evidenceClass: isEmployeeOutput(type) ? "output_evidence" : "activity_observation",
      title: label(type),
      summary: `${label(type)}${objectId ? ` for CRM record ${objectId}` : ""}.`,
      occurredAt: new Date(occurredAt).toISOString(),
      metadata: { type, objectId, locationId: payload.locationId, companyId: payload.companyId },
      raw: payload,
    });
    return NextResponse.json({ accepted: true, attributed: result.attributed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GHL evidence ingestion failed";
    return NextResponse.json({ error: message }, { status: message.includes("not connected") ? 404 : 500 });
  }
}
