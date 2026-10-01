import { NextResponse } from "next/server";
import { ingestProviderEvidence } from "@/lib/work-os-evidence";
import {
  githubObservation,
  isValidGithubWebhookSignature,
  linkedNiftyTask,
  type WorkOsWebhookJson,
} from "@/lib/work-os-provider-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.WORK_OS_GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "GitHub webhook is not configured" }, { status: 503 });
  const raw = await req.text();
  if (!isValidGithubWebhookSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid GitHub webhook signature" }, { status: 401 });
  }
  const event = req.headers.get("x-github-event") || "unknown";
  const delivery = req.headers.get("x-github-delivery");
  if (event === "ping") return NextResponse.json({ ok: true });
  let payload: WorkOsWebhookJson;
  try {
    payload = JSON.parse(raw) as WorkOsWebhookJson;
  } catch {
    return NextResponse.json({ error: "invalid GitHub webhook payload" }, { status: 400 });
  }
  const observation = githubObservation(event, payload);
  if (!observation || !delivery) return NextResponse.json({ accepted: true, evidence: false });
  // The actor is the subject of the evidence (commit author, PR author, or the
  // acting sender). The login alias lets an admin map an account by username
  // instead of the numeric GitHub id.
  const actorId = observation.actor?.id ?? (payload.sender?.id != null ? String(payload.sender.id) : null);
  const actorLogin = observation.actor?.login ?? (typeof payload.sender?.login === "string" ? payload.sender.login : null);
  try {
    const result = await ingestProviderEvidence({
      provider: "github",
      externalWorkspaceIds: [
        payload.installation?.id,
        payload.organization?.id,
        payload.repository?.owner?.id,
        payload.repository?.owner?.login,
      ].filter(Boolean).map(String),
      externalEventId: delivery,
      externalActorId: actorId,
      externalActorAliases: actorLogin ? [actorLogin] : [],
      evidenceClass: "output_evidence",
      title: observation.title,
      summary: observation.summary,
      artifactUrl: observation.artifactUrl ?? null,
      occurredAt: observation.occurredAt || new Date().toISOString(),
      explicitTaskProviderId: linkedNiftyTask(payload),
      metadata: {
        event,
        action: payload.action,
        repository: payload.repository?.full_name,
        actor: { id: actorId, login: actorLogin },
      },
      raw: payload,
    });
    return NextResponse.json({ accepted: true, attributed: result.attributed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub evidence ingestion failed";
    return NextResponse.json({ error: message }, { status: message.includes("not connected") ? 404 : 500 });
  }
}
