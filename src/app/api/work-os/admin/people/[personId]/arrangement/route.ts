import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";
import { reviewWorkArrangement } from "@/lib/work-os-arrangement-review";

export const runtime = "nodejs";
export async function POST(req: Request, { params }: { params: Promise<{ personId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({ authorization: req.headers.get("authorization"), organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
    if (auth.response) return auth.response;
    const { personId } = await params;
    const denied = await requireWorkOsPersonAccess(auth.access, personId);
    if (denied) return denied;
    const body = await req.json();
    return NextResponse.json(await reviewWorkArrangement(auth.access, personId, body && typeof body === "object" ? body : {}));
  } catch (error) { return jsonError(error); }
}
