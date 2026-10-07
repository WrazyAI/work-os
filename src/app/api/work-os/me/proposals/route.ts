import { NextResponse } from "next/server";
import { listWorkOsProposals, proposeInterpretedWorkUpdate } from "@/lib/work-os-companion";
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

/** Statuses the owner's review surfaces may ask for. The overnight sweep and
 * provider-recovery states (applying and beyond) are deliberately excluded. */
const REVIEWABLE_PROPOSAL_STATUSES = new Set(["pending", "failed", "needs_review", "stale"]);

export async function GET(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const requested = new URL(req.url).searchParams.get("status");
    const statuses = requested
      ? requested.split(",").map((value) => value.trim()).filter((value) => REVIEWABLE_PROPOSAL_STATUSES.has(value))
      : ["pending"];
    return NextResponse.json({ proposals: await listWorkOsProposals(auth.access, auth.access.personId as string, statuses.length ? statuses : ["pending"]) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const key = req.headers.get("idempotency-key");
    if (!key) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    return NextResponse.json(await proposeInterpretedWorkUpdate(auth.access, await req.json(), key), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
