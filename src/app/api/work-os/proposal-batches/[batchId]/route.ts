import { NextResponse } from "next/server";
import { getWorkOsProposalBatch, reviewWorkOsProposalBatch } from "@/lib/work-os-companion";
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

/** Owner-scoped readback so a card can rebuild itself after a reload. */
export async function GET(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { batchId } = await params;
    return NextResponse.json(
      await getWorkOsProposalBatch(auth.access, batchId),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

/** Approves or rejects every pending item in one batch. */
export async function POST(req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { batchId } = await params;
    const body = await req.json();
    body.decision_idempotency_key = req.headers.get("idempotency-key") || body.decision_idempotency_key;
    return NextResponse.json(await reviewWorkOsProposalBatch(auth.access, batchId, body));
  } catch (error) {
    return jsonError(error);
  }
}
