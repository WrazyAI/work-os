import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess, WorkOsValidationError } from "@/lib/work-os-api";
import { listWorkMemory, listWorkMemoryFacts } from "@/lib/work-memory";

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
    const scope = {
      organizationId: auth.access.organizationId,
      personId: auth.access.personId as string,
    };
    const params = new URL(req.url).searchParams;
    const status = params.get("status");
    if (status !== null && status !== "confirmed" && status !== "candidate") throw new WorkOsValidationError("Invalid memory status.");
    const memory = status ? await listWorkMemoryFacts(scope, { status, cursor: params.get("cursor") }) : await listWorkMemory(scope);
    return NextResponse.json(memory, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
