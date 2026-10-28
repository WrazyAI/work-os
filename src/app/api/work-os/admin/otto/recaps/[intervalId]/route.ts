import { NextResponse } from "next/server";
import { requireAdminOttoAccess } from "@/lib/work-os-admin-otto-access";
import { getAdminOttoRecap } from "@/lib/work-os-admin-otto-reads";
import { jsonError } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function wired(response: NextResponse) {
  const body = await response.json().catch(() => ({}));
  return NextResponse.json({ schemaVersion: 1, ...body }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Exact reviewed recap detail; inferred, missing or foreign intervals are
 * unavailable rather than synthesized. */
export async function GET(req: Request, { params }: { params: Promise<{ intervalId: string }> }) {
  try {
    const auth = await requireAdminOttoAccess(req);
    if (auth.response) return wired(auth.response);
    const { intervalId } = await params;
    const recap = await getAdminOttoRecap(auth.access, intervalId);
    if (!recap) return wired(NextResponse.json({ error: "unavailable" }, { status: 404 }));
    return NextResponse.json({ schemaVersion: 1, recap }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return wired(jsonError(error));
  }
}
