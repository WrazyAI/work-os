import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { listWorkMemory } from "@/lib/work-memory";

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
    const memory = await listWorkMemory({
      organizationId: auth.access.organizationId,
      personId: auth.access.personId as string,
    });
    return NextResponse.json(memory);
  } catch (error) {
    return jsonError(error);
  }
}
