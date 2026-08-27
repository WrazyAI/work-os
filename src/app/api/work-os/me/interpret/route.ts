import { NextResponse } from "next/server";
import { interpretWorkUpdate, loadInterpretationTasks } from "@/lib/aiInterpret";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { getWorkOsOrganizationOwnerId } from "@/lib/work-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = (await req.json()) as { input?: unknown; planIntent?: unknown; today?: unknown };
    if (typeof body?.input !== "string" || !body.input.trim()) {
      return NextResponse.json({ error: "input is required" }, { status: 400 });
    }
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const tasks = await loadInterpretationTasks(ownerId, auth.access.personId as string);
    const result = await interpretWorkUpdate(body, tasks);
    if (!result.ok) {
      const status = result.reason === "ai_unconfigured" ? 501 : 503;
      return NextResponse.json({ error: result.detail ?? "AI interpretation unavailable", reason: result.reason }, { status });
    }
    return NextResponse.json({ interpretation: result.interpretation, model: result.model });
  } catch (error) {
    return jsonError(error);
  }
}
