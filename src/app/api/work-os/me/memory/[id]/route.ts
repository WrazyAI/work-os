import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { audit } from "@/lib/work-os-internal";
import { deleteWorkMemoryItem, reviewWorkMemoryFact } from "@/lib/work-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { status?: unknown };
    if (body.status !== "confirmed" && body.status !== "rejected") {
      return NextResponse.json({ error: "status must be confirmed or rejected" }, { status: 400 });
    }
    const scope = { organizationId: auth.access.organizationId, personId: auth.access.personId as string };
    const fact = await reviewWorkMemoryFact(scope, id, body.status);
    if (!fact) return NextResponse.json({ error: "memory fact not found" }, { status: 404 });
    await audit(auth.access, body.status === "confirmed" ? "memory.fact_confirmed" : "memory.fact_rejected", "work_memory_item", id, {});
    return NextResponse.json({ fact });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const { id } = await params;
    const scope = { organizationId: auth.access.organizationId, personId: auth.access.personId as string };
    const deleted = await deleteWorkMemoryItem(scope, id);
    if (!deleted) return NextResponse.json({ error: "memory item not found" }, { status: 404 });
    await audit(auth.access, "memory.item_deleted", "work_memory_item", id, {});
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
