import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { buildMemoryPromptBlock, memoryEnabled } from "@/lib/work-memory";
import { buildTodaySnapshot } from "@/lib/work-memory-today";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dev-only prompt probe: returns the assembled live-day snapshot and recalled
 * memory block so tests can assert the agent context wiring. Always inactive in
 * production; still requires a normal Work OS session. */
const probeEnabled = process.env.NODE_ENV !== "production";

export async function POST(req: Request) {
  if (!probeEnabled) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = (await req.json().catch(() => ({}))) as { query?: unknown; date?: unknown };
    const localDate = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    const scope = { organizationId: auth.access.organizationId, personId: auth.access.personId as string, localDate };
    const todayBlock = await buildTodaySnapshot(scope);
    if (!memoryEnabled(auth.access.featureFlags)) {
      return NextResponse.json({ memoryEnabled: false, todayBlock, memoryBlock: null, localDate });
    }
    const query = typeof body.query === "string" && body.query.trim() ? body.query : "recent progress and blockers";
    const memoryBlock = await buildMemoryPromptBlock(scope, query, { limit: 8 });
    return NextResponse.json({ memoryEnabled: true, todayBlock, memoryBlock, localDate });
  } catch (error) {
    return jsonError(error);
  }
}
