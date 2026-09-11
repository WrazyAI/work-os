import { NextResponse } from "next/server";
import { listOutstandingEods } from "@/lib/work-os-eod";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const url = new URL(req.url);
    const requested = Number(url.searchParams.get("days") ?? 14);
    if (!Number.isFinite(requested) || requested < 1 || requested > 31) {
      return NextResponse.json({ error: "days must be between 1 and 31" }, { status: 400 });
    }
    const outstanding = await listOutstandingEods(auth.access, Math.floor(requested));
    return NextResponse.json(outstanding);
  } catch (error) {
    return jsonError(error);
  }
}
