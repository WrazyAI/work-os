import { NextResponse } from "next/server";
import { WorkOsValidationError, jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { loadWorkOsGuideState, markWorkOsGuideSeen, setWorkOsGuideAutoOpen } from "@/lib/work-os-guides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** First-visit page-guide flags for the signed-in member. Reads and writes are
 * scoped to the caller's own membership row; no membership id ever travels in
 * a request body. */
async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
  });
}

export async function GET(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    return NextResponse.json(await loadWorkOsGuideState(auth.access));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new WorkOsValidationError("A guide key or an auto-open preference is required.");
    }
    if ("guide" in body) return NextResponse.json(await markWorkOsGuideSeen(auth.access, (body as { guide: unknown }).guide));
    if ("autoOpen" in body) return NextResponse.json(await setWorkOsGuideAutoOpen(auth.access, (body as { autoOpen: unknown }).autoOpen));
    throw new WorkOsValidationError("A guide key or an auto-open preference is required.");
  } catch (error) {
    return jsonError(error);
  }
}
